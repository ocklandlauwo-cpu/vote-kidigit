import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { EventPage } from '@vote-kidigit/shared';
import { App } from 'antd';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ME_KEY } from '../../auth/useAuth';
import { jsonResponse, renderWithProviders, routeFetch, testQueryClient } from '../../test/render';
import { EventsPage } from './EventsPage';
import { eventDetail, me } from './fixtures.test-utils';

function page(items: EventPage['items'] = []): EventPage {
  return { items, total: items.length, page: 1, pageSize: 50 };
}

/** Answers every GET /v1/events?… with `result`, recording the query strings asked for. */
function stubList(result: (query: URLSearchParams) => EventPage) {
  const queries: URLSearchParams[] = [];
  vi.stubGlobal('fetch', (url: string) => {
    const query = new URLSearchParams(url.split('?')[1] ?? '');
    queries.push(query);
    return Promise.resolve(jsonResponse(200, result(query)));
  });
  return queries;
}

function renderPage(permissions: Parameters<typeof me>[0], path = '/events') {
  const queryClient = testQueryClient();
  queryClient.setQueryData(ME_KEY, me(permissions));
  return renderWithProviders(
    <App>
      <EventsPage />
    </App>,
    { path, queryClient, routes: [{ path: '/events/:eventId', element: <p>workspace</p> }] },
  );
}

describe('EVT-01 event list', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('filters by status with the chips and keeps the filter in the URL', async () => {
    const queries = stubList(() => page([eventDetail('open')]));
    const { router } = renderPage(['event.view', 'event.create']);
    expect(await screen.findByText('AGM 2027')).toBeInTheDocument();
    const chips = [...document.querySelectorAll('[data-status-filter]')].map(
      (el) => el.textContent,
    );
    expect(chips).toEqual([
      'Zote',
      'Rasimu',
      'Imepangwa',
      'Wazi',
      'Imefungwa',
      'Matokeo yametangazwa',
      'Imesitishwa',
      'Kumbukumbu',
    ]);
    await userEvent.click(document.querySelector('[data-status-filter="open"]') as HTMLElement);
    await waitFor(() => expect(queries.at(-1)?.get('status')).toBe('open'));
    expect(router.state.location.search).toBe('?status=open');
    await userEvent.click(document.querySelector('[data-status-filter="all"]') as HTMLElement);
    await waitFor(() => expect(queries.at(-1)?.has('status')).toBe(false));
  });

  it('searches by name', async () => {
    const queries = stubList(() => page([eventDetail('draft')]));
    renderPage(['event.view']);
    await screen.findByText('AGM 2027');
    await userEvent.type(screen.getByRole('searchbox'), 'Bodi{Enter}');
    await waitFor(() => expect(queries.at(-1)?.get('q')).toBe('Bodi'));
  });

  it('offers "Show deactivated" to Admins only, and greys those rows', async () => {
    const queries = stubList((q) =>
      page(
        q.get('includeInactive')
          ? [eventDetail('draft', { isActive: false, name: 'Imezimwa' })]
          : [],
      ),
    );
    const view = renderPage(['event.view', 'event.access_all']);
    await userEvent.click(await screen.findByRole('switch', { name: 'Onyesha zilizozimwa' }));
    await waitFor(() => expect(queries.at(-1)?.get('includeInactive')).toBe('true'));
    expect(await screen.findByText('Imezimwa')).toBeInTheDocument();
    expect(screen.getByText('Umezimwa')).toBeInTheDocument();
    view.unmount();

    stubList(() => page());
    renderPage(['event.view']);
    await screen.findByText('Chaguzi', { selector: 'h1' });
    expect(screen.queryByRole('switch', { name: 'Onyesha zilizozimwa' })).toBeNull();
  });

  it('shows the empty states: none yet, none assigned, none with this status', async () => {
    stubList(() => page());
    let view = renderPage(['event.view', 'event.create']);
    expect(
      await screen.findByText('Hakuna chaguzi bado. Unda uchaguzi wako wa kwanza.'),
    ).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /Unda uchaguzi/ }).length).toBeGreaterThan(0);
    view.unmount();

    view = renderPage(['event.view']);
    expect(
      await screen.findByText('Bado hujapangiwa uchaguzi wowote. Wasiliana na msimamizi wako.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Unda uchaguzi/ })).toBeNull();
    view.unmount();

    renderPage(['event.view'], '/events?status=closed');
    expect(await screen.findByText('Hakuna chaguzi zenye hali “Imefungwa”.')).toBeInTheDocument();
  });

  it('opens an event from its row', async () => {
    stubList(() => page([eventDetail('scheduled')]));
    const { router } = renderPage(['event.view']);
    await userEvent.click(await screen.findByText('AGM 2027'));
    await waitFor(() =>
      expect(router.state.location.pathname).toBe('/events/0190f0a1-2b3c-7d4e-8f90-0000000000f1'),
    );
  });
});

describe('EVT-02 create event', () => {
  afterEach(() => vi.unstubAllGlobals());

  function renderDialog() {
    const stub = routeFetch({
      'GET /v1/events': () => jsonResponse(200, page()),
      'POST /v1/events': () => jsonResponse(201, eventDetail('draft')),
    });
    vi.stubGlobal('fetch', stub.fetch);
    const view = renderPage(['event.view', 'event.create'], '/events?create=1');
    return { ...view, calls: stub.calls };
  }

  /** Types a date into an Ant Design picker (format "D MMM YYYY, HH:mm") and confirms it. */
  async function pick(label: string, text: string) {
    const input = screen.getByLabelText(label);
    await userEvent.click(input);
    await userEvent.clear(input);
    await userEvent.type(input, `${text}{Enter}`);
  }

  it('asks for a name, a start and an end', async () => {
    const { calls } = renderDialog();
    await userEvent.click(await screen.findByRole('button', { name: 'Unda' }));
    expect(await screen.findByText('Andika jina lenye herufi 2 hadi 150')).toBeInTheDocument();
    expect(screen.getAllByText('Chagua tarehe na saa')).toHaveLength(2);
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
  });

  it('refuses an end before the start', async () => {
    const { calls } = renderDialog();
    await userEvent.type(await screen.findByLabelText('Jina la uchaguzi'), 'AGM 2027');
    await pick('Kuanza', '20 Nov 2030, 14:00');
    await pick('Kumalizika', '20 Nov 2030, 09:00');
    await userEvent.click(screen.getByRole('button', { name: 'Unda' }));
    expect(
      await screen.findByText('Muda wa kumalizika lazima uwe baada ya kuanza'),
    ).toBeInTheDocument();
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
  });

  it('warns about a start in the past but still creates, in the organization time zone', async () => {
    const { calls, router } = renderDialog();
    await userEvent.type(await screen.findByLabelText('Jina la uchaguzi'), 'AGM 2027');
    await pick('Kuanza', '1 Jan 2020, 08:00');
    expect(
      await screen.findByText(
        'Muda huu umeshapita. Bado unaweza kuhifadhi na kutumia Fungua sasa.',
      ),
    ).toBeInTheDocument();
    await pick('Kumalizika', '1 Jan 2020, 16:00');
    await userEvent.click(screen.getByRole('button', { name: 'Unda' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true));
    // 08:00 in Dar es Salaam (UTC+3) is 05:00 UTC.
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({
      name: 'AGM 2027',
      startAt: '2020-01-01T05:00:00.000Z',
      endAt: '2020-01-01T13:00:00.000Z',
    });
    await waitFor(() =>
      expect(router.state.location.pathname).toBe('/events/0190f0a1-2b3c-7d4e-8f90-0000000000f1'),
    );
  });
});
