import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  type ChecklistItem,
  checklistItems,
  type EventDetail,
  type EventStatus,
  type PermissionKey,
} from '@vote-kidigit/shared';
import { App } from 'antd';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ME_KEY } from '../../auth/useAuth';
import { jsonResponse, renderWithProviders, testQueryClient } from '../../test/render';
import { EventOverview } from './EventOverview';
import { EventWorkspace } from './EventWorkspace';
import { EVENT_ID, eventDetail, me } from './fixtures.test-utils';

const ALL: PermissionKey[] = [
  'event.view',
  'event.edit',
  'event.publish',
  'event.cancel',
  'event.archive',
  'event.activate',
  'audit.view.event',
];

const checklist = (failing: string[] = []): { items: ChecklistItem[] } => ({
  items: checklistItems.map((item) => ({ item, ok: !failing.includes(item), detail: {} })),
});

interface Call {
  method: string;
  path: string;
  body: unknown;
}

function renderWorkspace(
  event: EventDetail,
  options: { failing?: string[]; publishError?: object; permissions?: PermissionKey[] } = {},
) {
  const calls: Call[] = [];
  vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const path = url.replace(/^\/api/, '');
    const body: unknown = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    calls.push({ method, path, body });
    if (path === `/v1/events/${EVENT_ID}`) return Promise.resolve(jsonResponse(200, event));
    if (path === `/v1/events/${EVENT_ID}/checklist`) {
      return Promise.resolve(jsonResponse(200, checklist(options.failing)));
    }
    if (method === 'POST' && path.endsWith('/publish') && options.publishError) {
      return Promise.resolve(jsonResponse(422, options.publishError));
    }
    if (method === 'POST') {
      return Promise.resolve(jsonResponse(200, { ...event, status: 'scheduled' as EventStatus }));
    }
    return Promise.resolve(jsonResponse(404, { code: 'NOT_FOUND', message: 'x' }));
  });
  const queryClient = testQueryClient();
  queryClient.setQueryData(ME_KEY, me(options.permissions ?? ALL));
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
        children: [{ index: true, element: <EventOverview /> }],
      },
    ],
  });
  void view.router.navigate(`/events/${EVENT_ID}`);
  return { ...view, calls };
}

const future = (hours: number) => new Date(Date.now() + hours * 3_600_000).toISOString();
const mainButton = () => document.querySelector('[data-main-action]') as HTMLElement;

describe('publishing (EVT-08)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('lists the failing checklist items with Fix links and publishes nothing', async () => {
    const { calls } = renderWorkspace(eventDetail('draft'), { failing: ['voters', 'eligibility'] });
    await screen.findByRole('heading', { level: 1, name: 'AGM 2027' });
    await userEvent.click(mainButton());
    expect(await screen.findByText('Uchaguzi bado haujawa tayari')).toBeInTheDocument();
    const problems = screen.getByTestId('publish-problems');
    expect(within(problems).getByText('Wapiga kura wameongezwa')).toBeInTheDocument();
    expect(within(problems).getAllByRole('link', { name: 'Rekebisha' })[0]).toHaveAttribute(
      'href',
      `/events/${EVENT_ID}/voters`,
    );
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
  });

  it('schedules a ready event, or opens it now', async () => {
    const event = eventDetail('draft', { startAt: future(24), endAt: future(32) });
    const { calls } = renderWorkspace(event);
    await screen.findByRole('heading', { level: 1, name: 'AGM 2027' });
    await userEvent.click(mainButton());
    expect(await screen.findByText('Chapisha AGM 2027')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Panga/ })).toBeChecked();
    await userEvent.click(screen.getByTestId('publish-confirm'));
    await waitFor(() =>
      expect(calls.find((c) => c.path.endsWith('/publish'))?.body).toEqual({
        mode: 'schedule',
        sendCodes: false,
      }),
    );
    expect(await screen.findByText('Uchaguzi umepangwa')).toBeInTheDocument();
  });

  it('sends codes with publishing when "Send codes now" is ticked', async () => {
    const event = eventDetail('draft', { startAt: future(24), endAt: future(32) });
    const { calls } = renderWorkspace(event, { permissions: [...ALL, 'messages.send'] });
    await screen.findByRole('heading', { level: 1, name: 'AGM 2027' });
    await userEvent.click(mainButton());
    const tick = await screen.findByRole('checkbox', { name: /Tuma misimbo sasa/ });
    expect(tick).not.toBeChecked();
    await userEvent.click(tick);
    await userEvent.click(screen.getByTestId('publish-confirm'));
    await waitFor(() =>
      expect(calls.find((c) => c.path.endsWith('/publish'))?.body).toEqual({
        mode: 'schedule',
        sendCodes: true,
      }),
    );
  });

  it('hides "Send codes now" without messages.send', async () => {
    const event = eventDetail('draft', { startAt: future(24), endAt: future(32) });
    renderWorkspace(event);
    await screen.findByRole('heading', { level: 1, name: 'AGM 2027' });
    await userEvent.click(mainButton());
    await screen.findByText('Chapisha AGM 2027');
    expect(screen.queryByTestId('publish-send-codes')).not.toBeInTheDocument();
  });

  it('offers only Open now once the start time has passed', async () => {
    const event = eventDetail('draft', {
      startAt: new Date(Date.now() - 3_600_000).toISOString(),
      endAt: future(4),
    });
    const { calls } = renderWorkspace(event);
    await screen.findByRole('heading', { level: 1, name: 'AGM 2027' });
    await userEvent.click(mainButton());
    expect(await screen.findByRole('radio', { name: /Panga/ })).toBeDisabled();
    expect(screen.getByRole('radio', { name: /Fungua sasa/ })).toBeChecked();
    await userEvent.click(screen.getByTestId('publish-confirm'));
    await waitFor(() =>
      expect(calls.find((c) => c.path.endsWith('/publish'))?.body).toMatchObject({
        mode: 'open_now',
      }),
    );
  });

  it('shows the items the server found when the checklist changed meanwhile', async () => {
    renderWorkspace(eventDetail('draft', { startAt: future(24), endAt: future(32) }), {
      publishError: {
        code: 'CHECKLIST_FAILED',
        message: 'x',
        details: { items: [{ item: 'contesters', ok: false, detail: {} }] },
      },
    });
    await screen.findByRole('heading', { level: 1, name: 'AGM 2027' });
    await userEvent.click(mainButton());
    await userEvent.click(await screen.findByTestId('publish-confirm'));
    const problems = await screen.findByTestId('publish-problems');
    expect(within(problems).getByText('Kila nafasi inayotumika ina mgombea')).toBeInTheDocument();
  });
});

describe('scheduled and cancelled events', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('opens a scheduled event now after confirmation', async () => {
    const { calls } = renderWorkspace(eventDetail('scheduled'));
    await screen.findByRole('heading', { level: 1, name: 'AGM 2027' });
    await userEvent.click(mainButton());
    expect(await screen.findByText('Fungua AGM 2027 sasa?')).toBeInTheDocument();
    const confirm = screen.getAllByRole('button', { name: 'Fungua sasa' }).at(-1) as HTMLElement;
    await userEvent.click(confirm);
    await waitFor(() =>
      expect(calls.find((c) => c.path.endsWith('/publish'))?.body).toEqual({
        mode: 'open_now',
        sendCodes: false,
      }),
    );
  });

  it('greys out Unpublish once codes have been sent', async () => {
    renderWorkspace(eventDetail('scheduled', { firstCodeSentAt: '2026-11-10T08:00:00.000Z' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Zaidi' }));
    const item = (await screen.findByText('Rudisha kuwa Rasimu')).closest('li') as HTMLElement;
    expect(item).toHaveAttribute('aria-disabled', 'true');
  });

  it('cancels only with the typed name and a reason', async () => {
    const { calls } = renderWorkspace(eventDetail('scheduled'));
    await userEvent.click(await screen.findByRole('button', { name: 'Zaidi' }));
    await userEvent.click(await screen.findByText('Sitisha uchaguzi'));
    expect(await screen.findByText('Sitisha AGM 2027?')).toBeInTheDocument();
    const confirm = () =>
      screen.getAllByRole('button', { name: 'Sitisha uchaguzi' }).at(-1) as HTMLElement;
    expect(confirm()).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Andika "AGM 2027" kuthibitisha'), 'AGM 2027');
    await userEvent.type(screen.getByLabelText('Sababu'), 'Mkutano umeahirishwa');
    await userEvent.click(confirm());
    await waitFor(() =>
      expect(calls.find((c) => c.path.endsWith('/cancel'))?.body).toEqual({
        confirmName: 'AGM 2027',
        reason: 'Mkutano umeahirishwa',
      }),
    );
  });

  it('shows the countdown and code counts of a scheduled event', async () => {
    renderWorkspace(eventDetail('scheduled', { startAt: future(50), endAt: future(58) }));
    const countdown = await screen.findByTestId('scheduled-countdown');
    expect(countdown).toHaveTextContent(/Unafunguliwa baada ya siku 2, saa (1|2)/);
    const counts = screen.getByTestId('code-counts');
    expect(counts).toHaveTextContent('Imetumwa600');
    expect(counts).toHaveTextContent('Imefika380');
    expect(counts).toHaveTextContent('Imeshindikana20');
    expect(screen.getByText('Orodha ya kuchapisha: yote 6 yamekamilika')).toBeInTheDocument();
  });

  it('shows when, by whom and why an event was cancelled', async () => {
    renderWorkspace(eventDetail('cancelled'));
    const summary = await screen.findByTestId('cancelled-summary');
    expect(summary).toHaveTextContent('Neema Mushi <neema@example.test>');
    expect(summary).toHaveTextContent('Mkutano umeahirishwa');
  });
});
