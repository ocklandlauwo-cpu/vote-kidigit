import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { EventResults, EventStatus, PermissionKey } from '@vote-kidigit/shared';
import { App } from 'antd';
import { Outlet } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ME_KEY } from '../../../auth/useAuth';
import {
  jsonResponse,
  renderWithProviders,
  routeFetch,
  testQueryClient,
} from '../../../test/render';
import { EVENT_ID, eventDetail, me } from '../fixtures.test-utils';
import { ResultsTab } from './ResultsTab';

const CAT = '0190f0a1-2b3c-7d4e-8f90-0000000004a1';
const ASHA = '0190f0a1-2b3c-7d4e-8f90-0000000004b1';
const JUMA = '0190f0a1-2b3c-7d4e-8f90-0000000004b2';

function results(change: Partial<EventResults> = {}): EventResults {
  return {
    state: 'closed',
    unresolvedTies: 1,
    publicUrl: null,
    publicEnabled: true,
    visibility: 'full',
    snapshot: {
      id: '0190f0a1-2b3c-7d4e-8f90-0000000004c1',
      version: 1,
      generatedAt: '2026-11-20T13:00:30.000Z',
      publishedAt: null,
      registeredVoters: 10,
      votersVoted: 8,
      contentHash: 'a'.repeat(64),
      categories: [
        {
          id: CAT,
          name: 'Mwenyekiti',
          seats: 1,
          thresholdPct: null,
          quorumPct: null,
          eligibleVoters: 10,
          votersVoted: 8,
          validVotes: 8,
          skipped: 0,
          quorumMet: null,
          thresholdMet: null,
          hasTie: true,
          tie: null,
          rows: [
            {
              contesterId: ASHA,
              name: 'Asha Mollel',
              party: null,
              photoUrl: null,
              choice: 'contester',
              votes: 4,
              percent: 50,
              rank: 1,
              isWinner: false,
            },
            {
              contesterId: JUMA,
              name: 'Juma Ali',
              party: null,
              photoUrl: null,
              choice: 'contester',
              votes: 4,
              percent: 50,
              rank: 1,
              isWinner: false,
            },
          ],
        },
      ],
    },
    ...change,
  };
}

const ALL: PermissionKey[] = [
  'event.view',
  'results.view',
  'results.publish',
  'results.resolve_tie',
];

function renderResults(data: EventResults, status: EventStatus = 'closed') {
  const { fetch, calls } = routeFetch({
    [`GET /v1/events/${EVENT_ID}/results`]: () => jsonResponse(200, data),
    [`POST /v1/events/${EVENT_ID}/results/ties`]: () => jsonResponse(200, data),
    [`POST /v1/events/${EVENT_ID}/results/publish`]: () => jsonResponse(200, data),
    [`POST /v1/events/${EVENT_ID}/results/public-link`]: () => jsonResponse(200, data),
  });
  vi.stubGlobal('fetch', fetch);
  const queryClient = testQueryClient();
  queryClient.setQueryData(ME_KEY, me(ALL));
  const view = renderWithProviders(<p />, {
    path: '/start',
    queryClient,
    routes: [
      {
        path: '/results',
        element: (
          <App>
            <Outlet context={eventDetail(status)} />
          </App>
        ),
        children: [{ index: true, element: <ResultsTab /> }],
      },
    ],
  });
  void view.router.navigate('/results');
  return { calls };
}

describe('RES-01 results tab', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('says when results come before voting closes', async () => {
    renderResults(results({ state: 'not_closed', snapshot: null, unresolvedTies: 0 }), 'open');
    expect(
      await screen.findByText(
        'Matokeo yatapatikana upigaji kura ukifungwa saa 20 Nov 2026, saa 16:00',
      ),
    ).toBeInTheDocument();
  });

  it('blocks publication while a tie is open, and resolves it with a reason', async () => {
    const { calls } = renderResults(results());
    expect(
      await screen.findByText('Sare 1 inahitaji uamuzi kabla ya kutangaza matokeo'),
    ).toBeInTheDocument();
    expect(screen.getByTestId('publish-results')).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Amua sare' }));
    const dialog = await screen.findByRole('dialog');
    const save = within(dialog).getByRole('button', { name: 'Hifadhi uamuzi' });
    expect(save).toBeDisabled();
    await userEvent.click(within(dialog).getByRole('checkbox', { name: 'Juma Ali' }));
    expect(within(dialog).getByRole('checkbox', { name: 'Asha Mollel' })).toBeDisabled();
    await userEvent.type(
      within(dialog).getByLabelText('Sababu (inahitajika)'),
      'Kura ya bahati mbele ya wote',
    );
    await userEvent.click(save);
    await waitFor(() =>
      expect(calls.find((c) => c.path.endsWith('/results/ties'))?.body).toEqual({
        categoryId: CAT,
        outcome: 'contester',
        winnerIds: [JUMA],
        reason: 'Kura ya bahati mbele ya wote',
      }),
    );
  });

  it('publishes after typing the event name, then offers the public link', async () => {
    const ready = results({ unresolvedTies: 0 });
    const { calls } = renderResults(ready);
    await userEvent.click(await screen.findByTestId('publish-results'));
    const dialog = await screen.findByRole('dialog');
    const confirm = within(dialog).getByRole('button', { name: 'Tangaza matokeo' });
    expect(confirm).toBeDisabled();
    await userEvent.type(within(dialog).getByRole('textbox'), 'AGM 2027');
    await userEvent.click(confirm);
    await waitFor(() =>
      expect(calls.find((c) => c.path.endsWith('/results/publish'))?.body).toEqual({
        confirmName: 'AGM 2027',
      }),
    );
  });

  it('turns the public link off', async () => {
    const { calls } = renderResults(
      results({
        state: 'published',
        unresolvedTies: 0,
        publicUrl: 'https://kura.example.test/results/abc',
      }),
      'results_published',
    );
    expect(await screen.findByTestId('public-url')).toHaveTextContent(
      'https://kura.example.test/results/abc',
    );
    await userEvent.click(screen.getByRole('switch', { name: 'Kiungo kiko wazi' }));
    await waitFor(() =>
      expect(calls.find((c) => c.path.endsWith('/results/public-link'))?.body).toEqual({
        enabled: false,
      }),
    );
  });
});
