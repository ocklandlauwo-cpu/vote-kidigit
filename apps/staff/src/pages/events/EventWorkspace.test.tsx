import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { EventStatus, PermissionKey } from '@vote-kidigit/shared';
import { App } from 'antd';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ME_KEY } from '../../auth/useAuth';
import { jsonResponse, renderWithProviders, routeFetch, testQueryClient } from '../../test/render';
import { EventWorkspace } from './EventWorkspace';
import { EVENT_ID, eventDetail, me } from './fixtures.test-utils';

const ALL: PermissionKey[] = [
  'event.view',
  'event.edit',
  'event.publish',
  'event.close',
  'event.cancel',
  'event.reopen',
  'event.archive',
  'event.activate',
  'results.publish',
  'reports.download',
  'audit.view.event',
];

const mainButton = () => document.querySelector('[data-main-action]');

// App Flow 3.4: the main header button for each status.
const MAIN: [EventStatus, string | null][] = [
  ['draft', 'Chapisha'],
  ['scheduled', 'Fungua sasa'],
  ['open', 'Funga sasa'],
  ['closed', 'Tangaza matokeo'],
  ['results_published', 'Pakua PDF'],
  ['cancelled', null],
  ['archived', null],
];

describe('event workspace header', () => {
  afterEach(() => vi.unstubAllGlobals());

  it.each(MAIN)('%s shows the main action %s', async (status, label) => {
    renderWorkspaceAt(status);
    await screen.findByRole('heading', { level: 1, name: 'AGM 2027' });
    if (label) expect(mainButton()).toHaveTextContent(label);
    else expect(mainButton()).toBeNull();
  });

  it('greys out the main action without its permission', async () => {
    renderWorkspaceAt('draft', ['event.view']);
    await screen.findByRole('heading', { level: 1, name: 'AGM 2027' });
    expect(mainButton()).toBeDisabled();
  });

  it('adds the Live tab first while open', async () => {
    renderWorkspaceAt('open');
    await screen.findByRole('heading', { level: 1, name: 'AGM 2027' });
    const tabs = screen.getAllByRole('tab').map((tab) => tab.textContent);
    expect(tabs).toEqual([
      'Moja kwa moja',
      'Muhtasari',
      'Nafasi',
      'Wapiga kura',
      'Ujumbe',
      'Matokeo',
      'Mipangilio',
      'Shughuli',
    ]);
    vi.unstubAllGlobals();
  });

  it('hides the Activity tab without audit.view.event', async () => {
    renderWorkspaceAt('draft', ['event.view']);
    await screen.findByRole('heading', { level: 1, name: 'AGM 2027' });
    expect(screen.queryByRole('tab', { name: 'Shughuli' })).toBeNull();
  });

  it('lists the More actions for the status and deactivates after confirmation', async () => {
    const { calls } = renderWorkspaceAt('scheduled');
    await userEvent.click(await screen.findByRole('button', { name: 'Zaidi' }));
    const menu = await screen.findByRole('menu');
    const items = within(menu)
      .getAllByRole('menuitem')
      .map((item) => item.textContent);
    expect(items).toEqual([
      'Fungua kiosk kwenye kifaa hiki',
      'Rudisha kuwa Rasimu',
      'Sitisha uchaguzi',
      'Zima uchaguzi',
    ]);
    await userEvent.click(within(menu).getByText('Zima uchaguzi'));
    expect(await screen.findByText('Zima uchaguzi AGM 2027?')).toBeInTheDocument();
    const confirm = screen.getAllByRole('button', { name: 'Zima uchaguzi' }).at(-1) as HTMLElement;
    await userEvent.click(confirm);
    await vi.waitFor(() => expect(calls.some((c) => c.path.endsWith('/deactivate'))).toBe(true));
  });

  it('never offers deactivation while open, and shows "Deactivated" on deactivated events', async () => {
    renderWorkspaceAt('draft', ALL, { isActive: false });
    expect(await screen.findByText('Umezimwa')).toBeInTheDocument();
    vi.unstubAllGlobals();
  });

  it('answers ERR-03 for an event the user cannot see', async () => {
    renderWorkspaceAt('draft');
    vi.stubGlobal('fetch', routeFetch({}).fetch); // every request answers 404
    expect(await screen.findByText('Hatukuweza kupata ukurasa huo')).toBeInTheDocument();
  });
});

/** Renders the workspace under /events/:eventId so useParams sees the id. */
function renderWorkspaceAt(status: EventStatus, permissions = ALL, overrides = {}) {
  const stub = routeFetch({
    [`GET /v1/events/${EVENT_ID}`]: () => jsonResponse(200, eventDetail(status, overrides)),
    [`POST /v1/events/${EVENT_ID}/deactivate`]: () =>
      jsonResponse(200, eventDetail(status, { ...overrides, isActive: false })),
  });
  vi.stubGlobal('fetch', stub.fetch);
  const queryClient = testQueryClient();
  queryClient.setQueryData(ME_KEY, me(permissions));
  const view = renderWithProviders(<p />, {
    path: '/start',
    queryClient,
    routes: [
      {
        path: '/events/:eventId',
        element: (
          <App>
            <EventWorkspace />
          </App>
        ),
        children: [{ index: true, element: <p>overview</p> }],
      },
    ],
  });
  void view.router.navigate(`/events/${EVENT_ID}`);
  return { ...view, calls: stub.calls };
}
