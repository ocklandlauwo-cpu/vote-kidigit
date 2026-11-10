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
import {
  jsonResponse,
  renderWithProviders,
  routeFetch,
  testQueryClient,
} from '../../../test/render';
import { EVENT_ID, eventDetail, me } from '../fixtures.test-utils';
import { CategoriesTab } from './CategoriesTab';
import { categoriesKey } from './categoriesApi';

const MANAGE: PermissionKey[] = [
  'event.view',
  'category.manage',
  'contester.manage',
  'event.close',
];

function category(n: number, name: string, change: Partial<Category> = {}): Category {
  return {
    id: `0190f0a1-2b3c-7d4e-8f90-0000000003${String(n).padStart(2, '0')}`,
    name,
    pictureUrl: null,
    displayOrder: n,
    isActive: true,
    opensAt: null,
    closesAt: null,
    manualState: 'auto',
    closedAt: null,
    status: 'not_open',
    rules: DEFAULT_CATEGORY_RULES,
    eligibility: 'all',
    eligibleVoters: 120,
    yesNo: false,
    contesters: [],
    ...change,
  };
}

const chair = category(1, 'Mwenyekiti', {
  yesNo: true,
  contesters: [
    {
      id: '0190f0a1-2b3c-7d4e-8f90-000000000401',
      categoryId: '0190f0a1-2b3c-7d4e-8f90-000000000301',
      fullName: 'Asha Mollel',
      party: null,
      photoUrl: null,
      status: 'active',
      withdrawnAt: null,
    },
  ],
});
const secretary = category(2, 'Katibu');
const treasurer = category(3, 'Mweka hazina');

function renderTab(
  status: EventStatus = 'draft',
  items: Category[] = [chair, secretary, treasurer],
  permissions = MANAGE,
) {
  const stub = routeFetch({
    [`GET /v1/events/${EVENT_ID}/categories`]: () => jsonResponse(200, { items }),
    [`PUT /v1/events/${EVENT_ID}/categories/order`]: (body) => {
      const order = (body as { categoryIds: string[] }).categoryIds;
      return jsonResponse(200, {
        items: order.map((id) => items.find((c) => c.id === id)),
      });
    },
    [`PATCH /v1/events/${EVENT_ID}/categories/${chair.id}`]: () => jsonResponse(200, chair),
    [`POST /v1/events/${EVENT_ID}/categories/${chair.id}/close`]: () =>
      jsonResponse(200, { ...chair, status: 'closed' }),
  });
  vi.stubGlobal('fetch', stub.fetch);
  const queryClient = testQueryClient();
  queryClient.setQueryData(ME_KEY, me(permissions));
  const view = renderWithProviders(<p />, {
    path: '/start',
    queryClient,
    routes: [
      {
        path: '/categories',
        element: (
          <App>
            <Outlet context={eventDetail(status)} />
          </App>
        ),
        children: [{ index: true, element: <CategoriesTab /> }],
      },
    ],
  });
  void view.router.navigate('/categories');
  return { ...view, calls: stub.calls };
}

const orderSent = (calls: { method: string; path: string; body: unknown }[]) =>
  (calls.find((c) => c.method === 'PUT')?.body as { categoryIds: string[] } | undefined)
    ?.categoryIds;

describe('EVT-04 categories tab', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('shows each card with its status, rule summary, voters and contesters', async () => {
    renderTab();
    const card = await screen.findByTestId(`category-${chair.id}`);
    expect(within(card).getByRole('heading', { name: 'Mwenyekiti' })).toBeInTheDocument();
    expect(within(card).getByText('Itafunguliwa')).toBeInTheDocument();
    expect(within(card).getByText('Kura ya Ndiyo / Hapana')).toBeInTheDocument();
    expect(within(card).getByText('Chagua 1 · kiti 1 · kuruka hakuruhusiwi')).toBeInTheDocument();
    expect(
      within(card).getByText('Muda wote wa uchaguzi · Wapiga kura 120 wanastahili'),
    ).toBeInTheDocument();
    expect(within(card).getByRole('button', { name: /Asha Mollel/ })).toBeInTheDocument();
    expect(within(card).getByRole('button', { name: /Ongeza mgombea/ })).toBeInTheDocument();
  });

  it('reorders with the up and down arrows on narrow screens', async () => {
    const { calls } = renderTab();
    const card = await screen.findByTestId(`category-${secretary.id}`);
    expect(
      within(await screen.findByTestId(`category-${chair.id}`)).getByRole('button', {
        name: 'Sogeza juu',
      }),
    ).toBeDisabled();
    await userEvent.click(within(card).getByRole('button', { name: 'Sogeza juu' }));
    await waitFor(() => expect(orderSent(calls)).toEqual([secretary.id, chair.id, treasurer.id]));
    expect(await screen.findByText('Mpangilio umehifadhiwa')).toBeInTheDocument();
  });

  it('reorders by keyboard: Space on the handle, arrow down, Space', async () => {
    // jsdom lays nothing out; give each card a 100 px high slot in list order.
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: HTMLElement,
    ) {
      const card = this.closest('[data-testid^="category-"]');
      const cards = [...document.querySelectorAll('[data-testid^="category-"]')];
      const top = card ? cards.indexOf(card) * 100 : 0;
      return {
        x: 0,
        y: top,
        top,
        left: 0,
        width: 600,
        height: 90,
        right: 600,
        bottom: top + 90,
        toJSON: () => ({}),
      };
    });
    const { calls } = renderTab();
    const handle = await screen.findByRole('button', {
      name: 'Buruta kubadilisha mpangilio wa Mwenyekiti',
    });
    handle.focus();
    await userEvent.keyboard('[Space]');
    await userEvent.keyboard('[ArrowDown]');
    await userEvent.keyboard('[Space]');
    await waitFor(() => expect(orderSent(calls)).toEqual([secretary.id, chair.id, treasurer.id]));
  });

  it('shows the live rule sentence while the rules are edited', async () => {
    const { calls } = renderTab();
    const card = await screen.findByTestId(`category-${chair.id}`);
    await userEvent.click(within(card).getByRole('button', { name: 'Zaidi' }));
    await userEvent.click(await screen.findByText('Kanuni'));
    expect(await screen.findByTestId('rule-sentence')).toHaveTextContent(
      'Wapiga kura wanachagua mgombea 1. Anayepata kura nyingi zaidi anashinda.',
    );
    await userEvent.click(screen.getByLabelText('Kati ya kiwango cha chini na cha juu'));
    await userEvent.type(await screen.findByLabelText('Kiwango cha chini'), '1');
    await userEvent.type(screen.getByLabelText('Kiwango cha juu'), '3');
    const seats = screen.getByLabelText('Viti');
    await userEvent.clear(seats);
    await userEvent.type(seats, '3');
    await waitFor(() =>
      expect(screen.getByTestId('rule-sentence')).toHaveTextContent(
        'Wapiga kura wanachagua kati ya wagombea 1 na 3. Wagombea 3 wenye kura nyingi zaidi wanashinda.',
      ),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Hifadhi' }));
    await waitFor(() =>
      expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({
        rules: {
          ...DEFAULT_CATEGORY_RULES,
          selectionMode: 'range',
          exactCount: null,
          minCount: 1,
          maxCount: 3,
          seats: 3,
        },
      }),
    );
  });

  it('refuses a maximum below the minimum in the rules panel', async () => {
    const { calls } = renderTab();
    const card = await screen.findByTestId(`category-${chair.id}`);
    await userEvent.click(within(card).getByRole('button', { name: 'Zaidi' }));
    await userEvent.click(await screen.findByText('Kanuni'));
    await userEvent.click(await screen.findByLabelText('Kati ya kiwango cha chini na cha juu'));
    await userEvent.type(await screen.findByLabelText('Kiwango cha chini'), '3');
    await userEvent.type(screen.getByLabelText('Kiwango cha juu'), '2');
    await userEvent.click(screen.getByRole('button', { name: 'Hifadhi' }));
    expect(
      await screen.findByText('Kiwango cha juu hakiwezi kuwa chini ya cha chini'),
    ).toBeInTheDocument();
    expect(calls.some((c) => c.method === 'PATCH')).toBe(false);
  });

  it('is read-only after publish', async () => {
    renderTab('scheduled');
    const card = await screen.findByTestId(`category-${chair.id}`);
    expect(
      screen.getByText('Nafasi haziwezi kubadilishwa baada ya uchaguzi kuchapishwa.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Ongeza nafasi/ })).toBeNull();
    expect(within(card).queryByRole('button', { name: /Buruta/ })).toBeNull();
    expect(within(card).queryByRole('button', { name: /Ongeza mgombea/ })).toBeNull();
    await userEvent.click(within(card).getByRole('button', { name: 'Zaidi' }));
    const menu = await screen.findByRole('menu');
    expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((i) => i.textContent),
    ).toEqual(['Angalia', 'Kanuni', 'Wapiga kura']);
  });

  it('closes an open category after confirmation', async () => {
    const open = { ...chair, status: 'open' as const };
    const { calls } = renderTab('open', [open, secretary]);
    const card = await screen.findByTestId(`category-${chair.id}`);
    await userEvent.click(within(card).getByRole('switch', { name: 'Funga nafasi' }));
    expect(await screen.findByText('Funga Mwenyekiti?')).toBeInTheDocument();
    expect(
      screen.getByText('Hakuna atakayeweza kupiga kura katika nafasi hii tena.'),
    ).toBeInTheDocument();
    const confirm = screen.getAllByRole('button', { name: 'Funga nafasi' }).at(-1) as HTMLElement;
    await userEvent.click(confirm);
    await waitFor(() => expect(calls.some((c) => c.path.endsWith('/close'))).toBe(true));
  });

  it('keeps an open panel up to date when the list refreshes (a new photo)', async () => {
    const { queryClient } = renderTab();
    const card = await screen.findByTestId(`category-${chair.id}`);
    await userEvent.click(within(card).getByRole('button', { name: /Asha Mollel/ }));
    expect(await screen.findByText('Hariri mgombea')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Hakuna picha' })).toBeInTheDocument();
    const withPhoto = {
      ...chair,
      contesters: chair.contesters.map((c) => ({ ...c, photoUrl: '/api/v1/files/new' })),
    };
    queryClient.setQueryData(categoriesKey(EVENT_ID), {
      items: [withPhoto, secretary, treasurer],
    });
    expect(await screen.findByRole('img', { name: 'Picha ya Asha Mollel' })).toHaveAttribute(
      'src',
      '/api/v1/files/new',
    );
  });

  it('offers the first category when there is none', async () => {
    renderTab('draft', []);
    expect(
      await screen.findByText('Hakuna nafasi bado. Ongeza nafasi ya kwanza.'),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Ongeza nafasi/ }));
    expect(await screen.findByText('Nafasi mpya')).toBeInTheDocument();
  });
});
