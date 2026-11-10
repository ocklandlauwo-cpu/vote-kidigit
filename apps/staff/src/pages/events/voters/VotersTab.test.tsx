import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  type Category,
  DEFAULT_CATEGORY_RULES,
  type EventStatus,
  type PermissionKey,
} from '@vote-kidigit/shared';
import { App } from 'antd';
import { Outlet } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ME_KEY } from '../../../auth/useAuth';
import { jsonResponse, renderWithProviders, testQueryClient } from '../../../test/render';
import { EVENT_ID, eventDetail, me } from '../fixtures.test-utils';
import { page, voter, voterDetail } from './voters.test-utils';
import { VotersTab } from './VotersTab';

const MANAGE: PermissionKey[] = ['event.view', 'voter.view', 'voter.manage', 'code.regenerate'];

const asha = voter(1, 'Asha Mollel');
const juma = voter(2, 'Juma Ali');

const chair: Category = {
  id: '0190f0a1-2b3c-7d4e-8f90-000000000301',
  name: 'Mwenyekiti',
  pictureUrl: null,
  displayOrder: 0,
  isActive: true,
  opensAt: null,
  closesAt: null,
  manualState: 'auto',
  closedAt: null,
  status: 'not_open',
  rules: DEFAULT_CATEGORY_RULES,
  eligibility: 'selected',
  eligibleVoters: 0,
  yesNo: false,
  contesters: [],
};

interface Call {
  method: string;
  path: string;
  body: unknown;
}

/** Answers by method and path (query strings ignored); records every call. */
function stub(routes: Record<string, (call: Call) => Response>) {
  const calls: Call[] = [];
  vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const path = url.replace(/^\/api/, '');
    const body: unknown = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    const call = { method, path, body };
    calls.push(call);
    const handler = routes[`${method} ${path.split('?')[0]}`];
    return Promise.resolve(
      handler ? handler(call) : jsonResponse(404, { code: 'NOT_FOUND', message: 'x' }),
    );
  });
  return calls;
}

function renderTab(status: EventStatus = 'draft', items = [asha, juma], permissions = MANAGE) {
  const calls = stub({
    [`GET /v1/events/${EVENT_ID}/voters`]: () => jsonResponse(200, page(items)),
    [`GET /v1/events/${EVENT_ID}/categories`]: () => jsonResponse(200, { items: [chair] }),
    [`GET /v1/events/${EVENT_ID}/voters/${asha.id}`]: () =>
      jsonResponse(
        200,
        voterDetail(asha, {
          messages: [
            {
              id: '0190f0a1-2b3c-7d4e-8f90-000000000801',
              type: 'code_delivery',
              channel: 'sms',
              status: 'delivered',
              bodyRedacted: 'Chama: Msimbo wa kura AGM 2027: ••••-••••.',
              createdAt: '2026-11-10T08:00:00.000Z',
              sentAt: '2026-11-10T08:00:02.000Z',
              deliveredAt: '2026-11-10T08:00:09.000Z',
              failedAt: null,
            },
          ],
        }),
      ),
    [`POST /v1/events/${EVENT_ID}/voters/${asha.id}/resend-code`]: () =>
      jsonResponse(200, voterDetail(asha)),
    [`POST /v1/events/${EVENT_ID}/voters/bulk`]: () => jsonResponse(200, { affected: 2 }),
    [`POST /v1/events/${EVENT_ID}/voters`]: () =>
      jsonResponse(400, {
        code: 'VALIDATION_FAILED',
        message: 'x',
        details: { issues: [{ path: 'membershipId', code: 'taken', message: 'taken' }] },
      }),
    [`POST /v1/events/${EVENT_ID}/voters/${asha.id}/regenerate-code`]: () =>
      jsonResponse(200, voterDetail(asha)),
  });
  const queryClient = testQueryClient();
  queryClient.setQueryData(ME_KEY, me(permissions));
  const view = renderWithProviders(<p />, {
    path: '/start',
    queryClient,
    routes: [
      {
        path: '/voters',
        element: (
          <App>
            <Outlet context={eventDetail(status)} />
          </App>
        ),
        children: [{ index: true, element: <VotersTab /> }],
      },
    ],
  });
  void view.router.navigate('/voters');
  return { ...view, calls };
}

describe('EVT-05 voters tab', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('lists voters with totals and masked phones', async () => {
    renderTab();
    expect(await screen.findByText('Asha Mollel')).toBeInTheDocument();
    expect(screen.getByText('Wapiga kura 2 wamesajiliwa')).toBeInTheDocument();
    expect(screen.getByText('Wanawake 1 · Wanaume 1')).toBeInTheDocument();
    expect(screen.getByText('••••••••••101')).toBeInTheDocument();
    expect(screen.getAllByText('Haijatumwa')).toHaveLength(2);
    expect(screen.getByRole('link', { name: /Pakua kiolezo/ })).toHaveAttribute(
      'href',
      `/api/v1/events/${EVENT_ID}/voters/template.csv`,
    );
  });

  it('searches and filters through the API', async () => {
    const { calls } = renderTab();
    await screen.findByText('Asha Mollel');
    await userEvent.type(screen.getByRole('searchbox'), 'asha{Enter}');
    await waitFor(() =>
      expect(calls.some((c) => c.path.includes('/voters?') && c.path.includes('q=asha'))).toBe(
        true,
      ),
    );
  });

  it('assigns the selected voters to a category from the bulk bar', async () => {
    const { calls } = renderTab();
    await screen.findByText('Asha Mollel');
    const boxes = screen.getAllByRole('checkbox');
    await userEvent.click(boxes[0] as HTMLElement); // select all
    const bar = await screen.findByRole('region', { name: 'Wapiga kura 2 wamechaguliwa' });
    await userEvent.click(within(bar).getByRole('combobox', { name: 'Chagua nafasi' }));
    await userEvent.click(await screen.findByTitle('Mwenyekiti'));
    await userEvent.click(within(bar).getByRole('button', { name: 'Weka kwenye nafasi' }));
    await waitFor(() =>
      expect(calls.find((c) => c.path.endsWith('/voters/bulk'))?.body).toEqual({
        action: 'assign',
        voterIds: [asha.id, juma.id],
        categoryId: chair.id,
      }),
    );
    expect(await screen.findByText('Wapiga kura 2 wamebadilishwa')).toBeInTheDocument();
  });

  it('shows a taken membership ID under the field when adding', async () => {
    renderTab();
    await screen.findByText('Asha Mollel');
    await userEvent.click(screen.getByRole('button', { name: /Ongeza mpiga kura/ }));
    await userEvent.type(await screen.findByLabelText('Jina kamili'), 'Neema');
    await userEvent.type(screen.getByLabelText('Namba ya uanachama'), 'M-101');
    await userEvent.type(screen.getByLabelText('Simu'), '0712 345 678');
    await userEvent.click(screen.getByLabelText('Mwanamke'));
    await userEvent.click(screen.getByRole('button', { name: 'Hifadhi' }));
    expect(
      await screen.findByText('Namba hii ya uanachama tayari ipo katika uchaguzi huu'),
    ).toBeInTheDocument();
  });

  it('refuses a phone that is not Tanzanian before sending', async () => {
    const { calls } = renderTab();
    await screen.findByText('Asha Mollel');
    await userEvent.click(screen.getByRole('button', { name: /Ongeza mpiga kura/ }));
    await userEvent.type(await screen.findByLabelText('Simu'), '12345');
    await userEvent.click(screen.getByRole('button', { name: 'Hifadhi' }));
    expect(
      await screen.findByText('Andika namba ya simu ya Tanzania, kwa mfano 0712 345 678'),
    ).toBeInTheDocument();
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
  });

  it('opens a voter, never shows the code, and regenerates it after confirmation', async () => {
    const { calls } = renderTab('scheduled');
    await userEvent.click(await screen.findByText('Asha Mollel'));
    const code = await screen.findByTestId('voter-code');
    expect(
      within(code).getByText('Msimbo hauonyeshwi kamwe; unatumwa kwa SMS tu.'),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Tengeneza msimbo mpya' }));
    expect(await screen.findByText('Tengeneza msimbo mpya kwa Asha Mollel?')).toBeInTheDocument();
    const confirm = screen
      .getAllByRole('button', { name: 'Tengeneza msimbo mpya' })
      .at(-1) as HTMLElement;
    await userEvent.click(confirm);
    await waitFor(() => expect(calls.some((c) => c.path.endsWith('/regenerate-code'))).toBe(true));
  });

  it('shows the SMS history without the code, and resends the same code', async () => {
    const { calls } = renderTab('scheduled', [asha, juma], [...MANAGE, 'messages.send']);
    await userEvent.click(await screen.findByText('Asha Mollel'));
    const history = await screen.findByTestId('voter-sms-history');
    expect(
      within(history).getByText('Chama: Msimbo wa kura AGM 2027: ••••-••••.'),
    ).toBeInTheDocument();
    expect(within(history).getByText('Imefika')).toBeInTheDocument();
    await userEvent.click(screen.getByTestId('voter-resend'));
    await waitFor(() => expect(calls.some((c) => c.path.endsWith('/resend-code'))).toBe(true));
    expect(await screen.findByText('Msimbo unatumwa tena')).toBeInTheDocument();
  });

  it('offers no Resend before publish or without messages.send', async () => {
    renderTab('draft', [asha, juma], [...MANAGE, 'messages.send']);
    await userEvent.click(await screen.findByText('Asha Mollel'));
    await screen.findByTestId('voter-sms-history');
    expect(screen.queryByTestId('voter-resend')).not.toBeInTheDocument();
  });

  it('is read-only after publish', async () => {
    renderTab('scheduled');
    await screen.findByText('Asha Mollel');
    expect(
      screen.getByText('Wapiga kura hawawezi kubadilishwa baada ya uchaguzi kuchapishwa.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Ongeza mpiga kura/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Pakia CSV/ })).toBeNull();
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
  });

  it('offers to add the first voter', async () => {
    renderTab('draft', []);
    expect(
      await screen.findByText('Hakuna wapiga kura bado. Ongeza mmoja au pakia CSV.'),
    ).toBeInTheDocument();
  });
});
