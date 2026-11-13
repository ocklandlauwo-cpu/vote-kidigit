// Global search (App Flow 3.6): nothing below 2 characters, grouped results, "No results for
// '{text}'", and a voter opens the Voters tab of their event with their panel.
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { SearchResults } from '@vote-kidigit/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ME_KEY } from '../auth/useAuth';
import { me } from '../pages/events/fixtures.test-utils';
import { jsonResponse, renderWithProviders, routeFetch, testQueryClient } from '../test/render';
import { GlobalSearch } from './GlobalSearch';

const EVENT = '0190f0a1-2b3c-7d4e-8f90-0000000008e1';
const VOTER = '0190f0a1-2b3c-7d4e-8f90-0000000008a1';

const found: SearchResults = {
  events: [{ id: EVENT, name: 'Uchaguzi Mkuu', status: 'open' }],
  voters: [
    {
      id: VOTER,
      fullName: 'Zuhura Ali',
      membershipId: 'M-0042',
      eventId: EVENT,
      eventName: 'Uchaguzi Mkuu',
    },
  ],
  staff: [],
};

function renderSearch() {
  const { fetch, calls } = routeFetch({
    'GET /v1/search?q=zu': () => jsonResponse(200, found),
    'GET /v1/search?q=xyz': () => jsonResponse(200, { events: [], voters: [], staff: [] }),
  });
  vi.stubGlobal('fetch', fetch);
  const queryClient = testQueryClient();
  queryClient.setQueryData(ME_KEY, me(['event.view', 'voter.view']));
  const view = renderWithProviders(<GlobalSearch compact={false} />, { path: '/', queryClient });
  return { view, calls };
}

describe('global search', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('asks for 2 characters before searching', async () => {
    const { calls } = renderSearch();
    await userEvent.type(screen.getByRole('combobox', { name: 'Tafuta' }), 'z');
    expect(await screen.findByText('Andika herufi 2 au zaidi')).toBeInTheDocument();
    expect(calls).toHaveLength(0);
  });

  it('groups results and opens a voter in their event', async () => {
    const { view } = renderSearch();
    await userEvent.type(screen.getByRole('combobox', { name: 'Tafuta' }), 'zu');
    expect(await screen.findByText('Chaguzi', {}, { timeout: 3_000 })).toBeInTheDocument();
    expect(screen.getByText('Wapiga kura')).toBeInTheDocument();
    expect(screen.getByText('M-0042 · Uchaguzi Mkuu')).toBeInTheDocument();
    await userEvent.click(screen.getByText('Zuhura Ali'));
    await waitFor(() =>
      expect(`${view.router.state.location.pathname}${view.router.state.location.search}`).toBe(
        `/events/${EVENT}/voters?voter=${VOTER}`,
      ),
    );
  });

  it('says when nothing matches', async () => {
    renderSearch();
    await userEvent.type(screen.getByRole('combobox', { name: 'Tafuta' }), 'xyz');
    expect(
      await screen.findByText('Hakuna matokeo ya ‘xyz’.', {}, { timeout: 3_000 }),
    ).toBeInTheDocument();
  });
});
