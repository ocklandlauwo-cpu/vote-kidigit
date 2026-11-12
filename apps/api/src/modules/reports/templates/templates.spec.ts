// Report templates (Implementation Plan step 28): snapshots of the results and voters HTML that
// Puppeteer prints, the words in both languages, escaping, and what the voters report leaves out.
import type { ResultSnapshot } from '@vote-kidigit/shared';
import { reportDateTime } from './report-text.js';
import { type ResultsReportData, resultsReportHtml } from './results-report.js';
import { type VotersReportData, votersReportHtml } from './voters-report.js';
import { auditWorkbook, votersWorkbook } from './workbooks.js';
import { sheetRows } from '../../../testing/xlsx.js';

const at = (iso: string) => new Date(iso);

const snapshot: ResultSnapshot = {
  id: '01900000-0000-7000-8000-000000000001',
  version: 2,
  generatedAt: '2026-11-20T13:01:00.000Z',
  publishedAt: '2026-11-20T14:00:00.000Z',
  registeredVoters: 5000,
  votersVoted: 3214,
  contentHash: 'a'.repeat(64),
  categories: [
    {
      id: '01900000-0000-7000-8000-000000000010',
      name: 'Mwenyekiti',
      seats: 1,
      thresholdPct: null,
      quorumPct: 50,
      eligibleVoters: 5000,
      votersVoted: 3200,
      validVotes: 3150,
      skipped: 50,
      quorumMet: true,
      thresholdMet: null,
      hasTie: true,
      tie: {
        outcome: 'contester',
        winnerIds: ['01900000-0000-7000-8000-000000000021'],
        reason: 'Kura ya bahati mbele ya wagombea wote',
        resolvedBy: 'Neema Mushi',
        resolvedAt: '2026-11-20T13:30:00.000Z',
      },
      rows: [
        {
          contesterId: '01900000-0000-7000-8000-000000000021',
          name: 'Asha Mollel',
          party: null,
          photoUrl: null,
          choice: 'contester',
          votes: 1575,
          percent: 50,
          rank: 1,
          isWinner: true,
        },
        {
          contesterId: '01900000-0000-7000-8000-000000000022',
          name: 'Juma <Ali>',
          party: 'Timu & Wenzake',
          photoUrl: null,
          choice: 'contester',
          votes: 1575,
          percent: 50,
          rank: 1,
          isWinner: false,
        },
      ],
    },
    {
      id: '01900000-0000-7000-8000-000000000011',
      name: 'Katiba mpya',
      seats: 1,
      thresholdPct: 66.7,
      quorumPct: null,
      eligibleVoters: 5000,
      votersVoted: 3100,
      validVotes: 3100,
      skipped: 0,
      quorumMet: null,
      thresholdMet: false,
      hasTie: false,
      tie: null,
      rows: [
        {
          contesterId: '01900000-0000-7000-8000-000000000031',
          name: 'Katiba mpya',
          party: null,
          photoUrl: null,
          choice: 'yes',
          votes: 1800,
          percent: 58.1,
          rank: 1,
          isWinner: false,
        },
        {
          contesterId: '01900000-0000-7000-8000-000000000031',
          name: 'Katiba mpya',
          party: null,
          photoUrl: null,
          choice: 'no',
          votes: 1300,
          percent: 41.9,
          rank: 2,
          isWinner: false,
        },
      ],
    },
  ],
};

function results(change: Partial<ResultsReportData> = {}): ResultsReportData {
  return {
    language: 'sw',
    timeZone: 'Africa/Dar_es_Salaam',
    organization: { name: 'Chama cha Walimu', logo: 'data:image/png;base64,AAAA' },
    event: {
      name: 'Uchaguzi Mkuu 2027',
      status: 'results_published',
      startAt: at('2026-11-20T05:00:00.000Z'),
      endAt: at('2026-11-20T13:00:00.000Z'),
      openedAt: at('2026-11-20T05:00:00.000Z'),
      closedAt: at('2026-11-20T13:00:00.000Z'),
      resultsPublishedAt: at('2026-11-20T14:00:00.000Z'),
    },
    snapshot,
    publicUrl: 'https://vote.example.test/results/abc123',
    qrSvg: '<svg data-qr="1"></svg>',
    generatedAt: at('2026-11-20T15:00:00.000Z'),
    generatedBy: 'Neema Mushi',
    font: null,
    ...change,
  };
}

function voters(change: Partial<VotersReportData> = {}): VotersReportData {
  return {
    language: 'sw',
    timeZone: 'Africa/Dar_es_Salaam',
    organization: { name: 'Chama cha Walimu', logo: null },
    event: { name: 'Uchaguzi Mkuu 2027', status: 'closed' },
    voters: [
      {
        fullName: 'Asha Mollel',
        membershipId: 'M-001',
        gender: 'female',
        phoneMasked: '•••••••••456',
        categories: ['Mwenyekiti', 'Katiba mpya'],
        allCategories: true,
        voted: true,
        codeStatus: 'delivered',
      },
      {
        fullName: '=HYPERLINK("x")',
        membershipId: 'M-002',
        gender: 'male',
        phoneMasked: '•••••••••789',
        categories: ['Mwenyekiti'],
        allCategories: false,
        voted: false,
        codeStatus: 'failed',
      },
    ],
    generatedAt: at('2026-11-20T15:00:00.000Z'),
    generatedBy: 'Neema Mushi',
    font: null,
    ...change,
  };
}

describe('report text', () => {
  it('writes dates the Design System 11.5 way in the organization time zone', () => {
    const when = at('2026-11-03T11:00:00.000Z');
    expect(reportDateTime(when, 'Africa/Dar_es_Salaam', 'sw')).toBe('3 Nov 2026, saa 14:00');
    expect(reportDateTime(when, 'Africa/Dar_es_Salaam', 'en')).toBe('3 Nov 2026, 14:00');
    expect(reportDateTime(at('2026-08-01T00:00:00Z'), 'UTC', 'sw')).toBe('1 Ago 2026, saa 00:00');
  });
});

describe('results report HTML', () => {
  it('matches the snapshot (Swahili)', () => {
    expect(resultsReportHtml(results())).toMatchSnapshot();
  });

  it('matches the snapshot (English, not yet published)', () => {
    expect(
      resultsReportHtml(
        results({
          language: 'en',
          publicUrl: null,
          qrSvg: null,
          snapshot: { ...snapshot, publishedAt: null },
          event: { ...results().event, status: 'closed', resultsPublishedAt: null },
        }),
      ),
    ).toMatchSnapshot();
  });

  it('has every REP-01 part', () => {
    const html = resultsReportHtml(results());
    for (const part of [
      'Chama cha Walimu',
      'data:image/png;base64,AAAA',
      'Uchaguzi Mkuu 2027',
      'Matokeo yametangazwa',
      'Upigaji kura ulifunguliwa',
      'Upigaji kura ulifungwa',
      '3,214 kati ya 5,000 (64.3%)',
      'Hawakuchagua: 50',
      'Sare iliamuliwa na Neema Mushi (20 Nov 2026, saa 16:30): Kura ya bahati mbele ya wagombea wote',
      'Akidi ya 50.0%: imetimia',
      'Kiwango cha 66.7%: hakijafikiwa',
      'Katiba mpya · Ndiyo',
      'Msimamizi wa uchaguzi',
      'Shahidi 2',
      '<svg data-qr="1"></svg>',
      'https://vote.example.test/results/abc123',
      'a'.repeat(64),
      'Imetolewa 20 Nov 2026, saa 18:00 na Neema Mushi',
    ]) {
      expect(html).toContain(part);
    }
  });

  it('escapes every value from the database', () => {
    const html = resultsReportHtml(results());
    expect(html).toContain('Juma &lt;Ali&gt;');
    expect(html).toContain('Timu &amp; Wenzake');
    expect(html).not.toContain('<Ali>');
  });
});

describe('voters report', () => {
  it('matches the snapshot', () => {
    expect(votersReportHtml(voters())).toMatchSnapshot();
  });

  it('shows the REP-02 columns and the totals in English too', () => {
    const html = votersReportHtml(voters({ language: 'en' }));
    for (const part of [
      'Membership ID',
      'Code SMS',
      'Delivered',
      'Not voted',
      'All',
      'Total 2 · voted 1',
    ]) {
      expect(html).toContain(part);
    }
  });

  it('writes the same rows to Excel, as text', async () => {
    const rows = await sheetRows(await votersWorkbook(voters()));
    expect(rows).toEqual([
      ['Jina', 'Namba ya uanachama', 'Jinsia', 'Simu', 'Nafasi', 'Hali', 'SMS ya namba'],
      ['Asha Mollel', 'M-001', 'Mwanamke', '•••••••••456', 'Zote', 'Amepiga kura', 'Imefika'],
      [
        '=HYPERLINK("x")',
        'M-002',
        'Mwanaume',
        '•••••••••789',
        'Mwenyekiti',
        'Hajapiga kura',
        'Imeshindikana',
      ],
    ]);
  });
});

describe('audit export', () => {
  it('lists the entries with event names and before/after as JSON', async () => {
    const bytes = await auditWorkbook({
      language: 'en',
      timeZone: 'Africa/Dar_es_Salaam',
      generatedAt: at('2026-11-20T15:00:00.000Z'),
      eventNames: new Map([['01900000-0000-7000-8000-0000000000e1', 'Uchaguzi Mkuu 2027']]),
      entries: [
        {
          id: '01900000-0000-7000-8000-0000000000a1',
          organizationId: null,
          organizationName: null,
          actorType: 'user',
          actorUserId: null,
          actorLabel: 'Neema Mushi (neema@example.test)',
          eventId: '01900000-0000-7000-8000-0000000000e1',
          action: 'event.close',
          entityType: 'voting_events',
          entityId: '01900000-0000-7000-8000-0000000000e1',
          before: { status: 'open' },
          after: { status: 'closed' },
          reason: null,
          ip: '10.0.0.1',
          createdAt: '2026-11-20T13:00:00.000Z',
        },
      ],
    });
    const rows = await sheetRows(bytes);
    expect(rows[0]?.[0]).toBe('Time');
    expect(rows[1]).toEqual([
      '20 Nov 2026, 16:00',
      'Neema Mushi (neema@example.test)',
      'event.close',
      'voting_events',
      '01900000-0000-7000-8000-0000000000e1',
      'Uchaguzi Mkuu 2027',
      '10.0.0.1',
      '',
      '{"status":"open"}',
      '{"status":"closed"}',
    ]);
  });
});
