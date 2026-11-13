// DSH-01 to DSH-04 (App Flow 5): each role gets its cards, cards load and fail independently,
// empty cards say what belongs there, and a moderator with one active event lands in it.
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { DashboardEvents, PermissionKey } from '@vote-kidigit/shared';
import { App } from 'antd';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ME_KEY } from '../../auth/useAuth';
import { jsonResponse, renderWithProviders, routeFetch, testQueryClient } from '../../test/render';
import { DashboardPage } from '../DashboardPage';
import { me } from '../events/fixtures.test-utils';

const EVENT = '0190f0a1-2b3c-7d4e-8f90-0000000007e1';
const CATEGORY = '0190f0a1-2b3c-7d4e-8f90-0000000007c1';

const events = (change: Partial<DashboardEvents['byStatus']> = {}): DashboardEvents => ({
  byStatus: { draft: 1, scheduled: 0, open: 1, closed: 1, results_published: 0, ...change },
  nextToOpen: null,
});

const ADMIN: PermissionKey[] = [
  'event.view',
  'event.create',
  'event.access_all',
  'turnout.view',
  'results.view',
  'results.resolve_tie',
  'audit.view.org',
];
const MODERATOR: PermissionKey[] = [
  'event.view',
  'event.edit',
  'turnout.view',
  'results.view',
  'results.resolve_tie',
  'audit.view.event',
];
const OBSERVER: PermissionKey[] = [
  'event.view',
  'turnout.view',
  'results.view',
  'audit.view.event',
];

const myEvent = (status: string) => ({
  eventId: EVENT,
  eventName: 'Uchaguzi Mkuu',
  status,
  startAt: '2026-11-20T05:00:00.000Z',
  endAt: '2026-11-20T13:00:00.000Z',
  role: 'moderator',
});

function renderDashboard(
  permissions: PermissionKey[],
  routes: Record<string, (body: unknown) => Response>,
  options: { landing?: boolean; platform?: boolean } = {},
) {
  const { fetch } = routeFetch({
    'GET /v1/dashboard/events': () => jsonResponse(200, events()),
    'GET /v1/dashboard/turnout': () =>
      jsonResponse(200, [
        {
          eventId: EVENT,
          eventName: 'Uchaguzi Mkuu',
          organizationName: null,
          registered: 10,
          voted: 4,
        },
      ]),
    'GET /v1/dashboard/ties': () =>
      jsonResponse(200, [
        {
          eventId: EVENT,
          eventName: 'Uchaguzi Mkuu',
          organizationName: null,
          categoryId: CATEGORY,
          categoryName: 'Katibu',
        },
      ]),
    'GET /v1/dashboard/activity': () => jsonResponse(200, []),
    'GET /v1/dashboard/event-staff': () =>
      jsonResponse(200, [
        {
          eventId: EVENT,
          eventName: 'Uchaguzi Mkuu',
          status: 'open',
          moderators: ['Musa'],
          categories: 3,
        },
      ]),
    'GET /v1/dashboard/my-events': () => jsonResponse(200, []),
    ...routes,
  });
  vi.stubGlobal('fetch', fetch);
  const queryClient = testQueryClient();
  queryClient.setQueryData(
    ME_KEY,
    me(permissions, options.platform ? { isPlatformAdmin: true, organization: null } : {}),
  );
  const view = renderWithProviders(<p />, {
    path: '/start',
    queryClient,
    routes: [
      {
        path: '/',
        element: (
          <App>
            <DashboardPage />
          </App>
        ),
      },
      { path: '/events/:eventId', element: <p>Overview</p> },
    ],
  });
  void view.router.navigate('/', { state: options.landing ? { landing: true } : null });
  return view;
}

describe('dashboards', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('gives the organization dashboard its cards and Create event', async () => {
    renderDashboard(ADMIN, {});
    const turnout = await screen.findByTestId('card-turnout', {}, { timeout: 5_000 });
    expect(await within(turnout).findByText('4 kati ya 10 · 40%')).toBeInTheDocument();
    const ties = screen.getByTestId('card-ties');
    expect(await within(ties).findByRole('link', { name: 'Amua' })).toHaveAttribute(
      'href',
      `/events/${EVENT}/results`,
    );
    expect(
      await within(screen.getByTestId('card-activity')).findByText('Hakuna shughuli bado.'),
    ).toBeInTheDocument();
    expect(
      await within(screen.getByTestId('card-event-staff')).findByText('Musa'),
    ).toBeInTheDocument();
    expect(screen.queryByTestId('card-my-events')).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /Unda uchaguzi/ }).length).toBeGreaterThan(0);
  });

  it('keeps the other cards when one fails, and retries it', async () => {
    let fail = true;
    renderDashboard(ADMIN, {
      'GET /v1/dashboard/ties': () =>
        fail ? jsonResponse(500, { code: 'INTERNAL', message: 'x' }) : jsonResponse(200, []),
    });
    const ties = await screen.findByTestId('card-ties', {}, { timeout: 5_000 });
    expect(await within(ties).findByText('Hatukuweza kupakia hiki.')).toBeInTheDocument();
    expect(
      await within(screen.getByTestId('card-turnout')).findByText('4 kati ya 10 · 40%'),
    ).toBeInTheDocument();
    fail = false;
    await userEvent.click(within(ties).getByRole('button', { name: 'Jaribu tena' }));
    expect(await within(ties).findByText('Hakuna sare za kuamua.')).toBeInTheDocument();
  });

  it('says so when a new organization has no events', async () => {
    renderDashboard(ADMIN, {
      'GET /v1/dashboard/events': () => jsonResponse(200, events({ draft: 0, open: 0, closed: 0 })),
      'GET /v1/dashboard/turnout': () => jsonResponse(200, []),
    });
    expect(
      await screen.findByText(
        'Hakuna chaguzi bado. Unda uchaguzi wako wa kwanza ili kuanza.',
        {},
        { timeout: 5_000 },
      ),
    ).toBeInTheDocument();
    expect(await screen.findByText('Hakuna uchaguzi ulio wazi kwa sasa.')).toBeInTheDocument();
  });

  it('takes a moderator with one active event straight to it after sign-in', async () => {
    const view = renderDashboard(
      MODERATOR,
      { 'GET /v1/dashboard/my-events': () => jsonResponse(200, [myEvent('open')]) },
      { landing: true },
    );
    await waitFor(() => expect(view.router.state.location.pathname).toBe(`/events/${EVENT}`), {
      timeout: 5_000,
    });
  });

  it('shows the moderator dashboard with two active events, with My events', async () => {
    const view = renderDashboard(
      MODERATOR,
      {
        'GET /v1/dashboard/my-events': () =>
          jsonResponse(200, [myEvent('open'), { ...myEvent('draft'), eventId: CATEGORY }]),
      },
      { landing: true },
    );
    const mine = await screen.findByTestId('card-my-events', {}, { timeout: 5_000 });
    expect(await within(mine).findAllByText('Uchaguzi Mkuu')).toHaveLength(2);
    expect(view.router.state.location.pathname).toBe('/');
    expect(screen.queryByTestId('card-event-staff')).not.toBeInTheDocument();
  });

  it('tells an observer with no events to contact the administrator, ties read-only', async () => {
    renderDashboard(OBSERVER, {});
    const mine = await screen.findByTestId('card-my-events', {}, { timeout: 5_000 });
    expect(
      await within(mine).findByText(
        'Bado hujapangiwa uchaguzi wowote. Wasiliana na msimamizi wako.',
      ),
    ).toBeInTheDocument();
    const ties = screen.getByTestId('card-ties');
    expect(await within(ties).findByText(/Katibu/)).toBeInTheDocument();
    expect(within(ties).queryByRole('link')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Unda uchaguzi/ })).not.toBeInTheDocument();
  });

  it('shows organizations to the platform, without event links', async () => {
    renderDashboard(
      [],
      {
        'GET /v1/dashboard/organizations': () =>
          jsonResponse(200, [
            {
              id: '0190f0a1-2b3c-7d4e-8f90-0000000007a1',
              name: 'Chama cha Walimu',
              status: 'active',
              events: 1,
              moderators: 1,
              categories: 3,
              voters: 1200,
              lastActivityAt: null,
              eventRows: [],
            },
          ]),
      },
      { platform: true },
    );
    const orgs = await screen.findByTestId('card-organizations', {}, { timeout: 5_000 });
    expect(await within(orgs).findByText('Chama cha Walimu')).toBeInTheDocument();
    expect(within(orgs).getByText('1,200')).toBeInTheDocument();
    const turnout = screen.getByTestId('card-turnout');
    expect(await within(turnout).findByText('Uchaguzi Mkuu')).toBeInTheDocument();
    expect(within(turnout).queryByRole('link')).not.toBeInTheDocument();
  });
});
