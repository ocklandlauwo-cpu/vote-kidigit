import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Live, PermissionKey } from '@vote-kidigit/shared';
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
import { LiveTab } from './LiveTab';

const CHAIR = '0190f0a1-2b3c-7d4e-8f90-0000000003a1';
const SECRETARY = '0190f0a1-2b3c-7d4e-8f90-0000000003a2';
const KIOSK = '0190f0a1-2b3c-7d4e-8f90-0000000009a1';

function live(change: Partial<Live> = {}): Live {
  return {
    status: 'open',
    endAt: new Date(Date.now() + 2 * 3_600_000).toISOString(),
    turnout: { voted: 3214, registered: 5000, percent: 64.3 },
    categories: [
      {
        id: CHAIR,
        name: 'Mwenyekiti',
        status: 'open',
        manualState: 'auto',
        opensAt: null,
        closesAt: null,
        voted: 3100,
        eligible: 5000,
      },
      {
        id: SECRETARY,
        name: 'Katibu',
        status: 'closed',
        manualState: 'closed',
        opensAt: null,
        closesAt: null,
        voted: 2900,
        eligible: 5000,
      },
    ],
    channels: { web: 2500, ussd: 0, kiosk: 714 },
    notVoted: 1786,
    lastBatch: null,
    kiosks: [
      {
        id: KIOSK,
        deviceLabel: 'Ukumbi A – Tablet 2',
        launchedBy: 'Juma Ali',
        startedAt: new Date().toISOString(),
        lastSeenAt: new Date().toISOString(),
      },
    ],
    alerts: [{ kind: 'lockouts', count: 4, categoryId: null, name: null, at: null }],
    updatedAt: new Date().toISOString(),
    ...change,
  };
}

const ALL: PermissionKey[] = [
  'event.view',
  'turnout.view',
  'event.close',
  'messages.send',
  'kiosk.operate',
];

function renderLive(data: Live = live()) {
  const { fetch, calls } = routeFetch({
    [`GET /v1/events/${EVENT_ID}/live`]: () => jsonResponse(200, data),
    [`POST /v1/events/${EVENT_ID}/categories/${CHAIR}/close`]: () => jsonResponse(200, {}),
    [`POST /v1/events/${EVENT_ID}/kiosk-sessions/${KIOSK}/end`]: () => jsonResponse(204, undefined),
  });
  vi.stubGlobal('fetch', fetch);
  const queryClient = testQueryClient();
  queryClient.setQueryData(ME_KEY, me(ALL));
  const view = renderWithProviders(<p />, {
    path: '/start',
    queryClient,
    routes: [
      {
        path: '/live',
        element: (
          <App>
            <Outlet context={eventDetail('open')} />
          </App>
        ),
        children: [{ index: true, element: <LiveTab /> }],
      },
    ],
  });
  void view.router.navigate('/live');
  return { calls };
}

describe('CTL-01 control room', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('shows turnout, alerts, channels and the reminder count', async () => {
    renderLive();
    expect(await screen.findByTestId('turnout')).toHaveTextContent(
      'Wamepiga kura 3,214 kati ya 5,000 · 64.3%',
    );
    expect(screen.getByText(/^Imesasishwa sekunde \d+ zilizopita$/)).toBeInTheDocument();
    expect(screen.getByText('Wapiga kura 4 wamezuiwa kwa majaribio mengi.')).toBeInTheDocument();
    expect(screen.getByText('714')).toBeInTheDocument();
    expect(
      screen.getByRole('button', {
        name: 'Tuma kumbusho kwa wapiga kura 1786 ambao bado hawajapiga kura',
      }),
    ).toBeEnabled();
  });

  it('closes a category only after confirming, and a closed one stays closed', async () => {
    const { calls } = renderLive();
    const open = await screen.findByRole('switch', { name: 'Fungua au funga Mwenyekiti' });
    expect(open).toBeChecked();
    expect(screen.getByRole('switch', { name: 'Fungua au funga Katibu' })).toBeDisabled();
    await userEvent.click(open);
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/haiwezi kufunguliwa tena/)).toBeInTheDocument();
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Funga nafasi' }));
    await waitFor(() =>
      expect(calls.some((c) => c.path.endsWith(`/categories/${CHAIR}/close`))).toBe(true),
    );
  });

  it('lists running kiosks and ends one', async () => {
    const { calls } = renderLive();
    expect(await screen.findByText('Ukumbi A – Tablet 2')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Funga kiosk' }));
    await waitFor(() =>
      expect(calls.some((c) => c.path.endsWith(`/kiosk-sessions/${KIOSK}/end`))).toBe(true),
    );
  });
});
