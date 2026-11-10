import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  type Batch,
  DEFAULT_TEMPLATES,
  type EventDetail,
  type EventStatus,
  type MessageTemplate,
  messageTypes,
  type PermissionKey,
} from '@vote-kidigit/shared';
import { App } from 'antd';
import { Outlet } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ME_KEY } from '../../../auth/useAuth';
import {
  type FetchCall,
  jsonResponse,
  renderWithProviders,
  routeFetch,
  testQueryClient,
} from '../../../test/render';
import { EVENT_ID, eventDetail, me } from '../fixtures.test-utils';
import { MessagesTab } from './MessagesTab';

const SENDER: PermissionKey[] = ['event.view', 'event.edit', 'messages.send', 'voter.view'];
const base = `/v1/events/${EVENT_ID}`;

const templates = (): { items: MessageTemplate[] } => ({
  items: messageTypes.flatMap((type) => [
    { type, channel: 'sms', subject: null, body: DEFAULT_TEMPLATES[type].sms, source: 'default' },
    {
      type,
      channel: 'email',
      subject: DEFAULT_TEMPLATES[type].subject,
      body: DEFAULT_TEMPLATES[type].sms,
      source: 'default',
    },
  ]),
});

function batch(change: Partial<Batch> = {}): Batch {
  return {
    id: '0190f0a1-2b3c-7d4e-8f90-000000000701',
    type: 'code_delivery',
    channel: 'sms',
    audience: 'all',
    status: 'completed',
    totalCount: 1200,
    sentCount: 1180,
    deliveredCount: 1100,
    failedCount: 20,
    pendingCount: 0,
    pausedReason: null,
    createdBy: 'Juma Ali',
    createdAt: '2026-11-10T08:00:00.000Z',
    startedAt: '2026-11-10T08:00:01.000Z',
    completedAt: '2026-11-10T08:03:00.000Z',
    ...change,
  };
}

const pageOf = (items: Batch[]) => ({ items, total: items.length, page: 1, pageSize: 25 });

function renderTab(
  event: EventDetail,
  options: {
    batches?: Batch[];
    permissions?: PermissionKey[];
    extra?: Record<string, (body: unknown) => Response>;
  } = {},
): { calls: FetchCall[] } {
  const { fetch, calls } = routeFetch({
    [`GET ${base}/templates`]: () => jsonResponse(200, templates()),
    [`GET ${base}/batches?page=1&pageSize=25`]: () =>
      jsonResponse(200, pageOf(options.batches ?? [])),
    ...options.extra,
  });
  vi.stubGlobal('fetch', fetch);
  const queryClient = testQueryClient();
  queryClient.setQueryData(ME_KEY, me(options.permissions ?? SENDER));
  const view = renderWithProviders(<p />, {
    path: '/start',
    queryClient,
    routes: [
      {
        path: '/messages',
        element: (
          <App>
            <Outlet context={event} />
          </App>
        ),
        children: [{ index: true, element: <MessagesTab /> }],
      },
    ],
  });
  void view.router.navigate('/messages');
  return { calls };
}

const scheduled = (status: EventStatus = 'scheduled') => eventDetail(status);

describe('EVT-07 Messages tab', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('shows the empty delivery state and greys Send codes before publish', async () => {
    renderTab(eventDetail('draft'));
    expect(await screen.findByText('Bado hakuna ujumbe uliotumwa')).toBeInTheDocument();
    expect(screen.getByTestId('send-codes')).toBeDisabled();
    expect(screen.queryByTestId('send-reminder')).not.toBeInTheDocument();
    // One card per message type, with the default text.
    expect(await screen.findByTestId('template-code_delivery')).toHaveTextContent('Msimbo wa kura');
    expect(screen.getAllByText('Maandishi ya kawaida')).toHaveLength(messageTypes.length);
  });

  it('sends codes to the chosen audience after showing the estimate', async () => {
    const { calls } = renderTab(scheduled(), {
      extra: {
        [`GET ${base}/batches/estimate?type=code_delivery&channel=sms&audience=not_sent`]: () =>
          jsonResponse(200, { recipients: 200, segments: 2, smsCount: 400 }),
        [`GET ${base}/batches/estimate?type=code_delivery&channel=sms&audience=failed`]: () =>
          jsonResponse(200, { recipients: 0, segments: 2, smsCount: 0 }),
        [`POST ${base}/batches`]: () => jsonResponse(201, batch({ status: 'queued' })),
      },
    });
    await userEvent.click(await screen.findByTestId('send-codes'));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('radio', { name: 'Ambao bado hawajatumiwa' })).toBeChecked();
    expect(
      await within(dialog).findByText('Wapiga kura 200 · takriban SMS 400'),
    ).toBeInTheDocument();

    await userEvent.click(within(dialog).getByRole('radio', { name: 'Walioshindikana tu' }));
    expect(await within(dialog).findByText('Hakuna mpiga kura wa kutumiwa.')).toBeInTheDocument();
    expect(within(dialog).getByTestId('send-confirm')).toBeDisabled();

    await userEvent.click(within(dialog).getByRole('radio', { name: 'Ambao bado hawajatumiwa' }));
    await waitFor(() => expect(within(dialog).getByTestId('send-confirm')).toBeEnabled());
    await userEvent.click(within(dialog).getByTestId('send-confirm'));
    await waitFor(() =>
      expect(calls.find((c) => c.method === 'POST')?.body).toEqual({
        type: 'code_delivery',
        channel: 'sms',
        audience: 'not_sent',
      }),
    );
    expect(await screen.findByText('Utumaji umeanza')).toBeInTheDocument();
  });

  it('offers "Send reminder now" only while Open', async () => {
    const { calls } = renderTab(scheduled('open'), {
      extra: {
        [`GET ${base}/batches/estimate?type=reminder_before_close&channel=sms&audience=not_voted`]:
          () => jsonResponse(200, { recipients: 900, segments: 1, smsCount: 900 }),
        [`POST ${base}/batches`]: () =>
          jsonResponse(201, batch({ type: 'reminder_before_close', status: 'queued' })),
      },
    });
    await userEvent.click(await screen.findByTestId('send-reminder'));
    const dialog = await screen.findByRole('dialog');
    expect(
      await within(dialog).findByText('Wapiga kura 900 · takriban SMS 900'),
    ).toBeInTheDocument();
    await userEvent.click(within(dialog).getByTestId('send-confirm'));
    await waitFor(() =>
      expect(calls.find((c) => c.method === 'POST')?.body).toMatchObject({
        type: 'reminder_before_close',
        audience: 'not_voted',
      }),
    );
  });

  it('lists batches, shows the pause banner, and resumes', async () => {
    const paused = batch({
      id: '0190f0a1-2b3c-7d4e-8f90-000000000702',
      status: 'paused',
      pausedReason: 'failure_rate',
      sentCount: 30,
      failedCount: 12,
      pendingCount: 158,
      totalCount: 200,
    });
    const { calls } = renderTab(scheduled(), {
      batches: [paused, batch()],
      extra: {
        [`POST ${base}/batches/${paused.id}/resume`]: () =>
          jsonResponse(200, { ...paused, status: 'sending' }),
      },
    });
    expect(
      await screen.findByText(
        'Utumaji umesimamishwa: jumbe 12 zimeshindikana. Kagua mtoa huduma wa SMS, kisha Endelea au Sitisha.',
      ),
    ).toBeInTheDocument();
    const table = screen.getByTestId('batch-table');
    expect(within(table).getByText('1,180')).toBeInTheDocument();
    expect(within(table).getByText('Imesimamishwa')).toBeInTheDocument();
    expect(
      within(table).getAllByRole('button', { name: 'Tuma tena zilizoshindikana' }),
    ).toHaveLength(2);
    await userEvent.click(screen.getByTestId('batch-resume'));
    await waitFor(() =>
      expect(calls.some((c) => c.method === 'POST' && c.path.endsWith('/resume'))).toBe(true),
    );
    expect(await screen.findByText('Utumaji unaendelea')).toBeInTheDocument();
  });

  it('opens a batch to show per-voter status, filtered', async () => {
    const done = batch();
    const message = {
      id: '0190f0a1-2b3c-7d4e-8f90-000000000801',
      voterId: '0190f0a1-2b3c-7d4e-8f90-000000000501',
      voterName: 'Asha Mwinyi',
      to: '••••••••••101',
      status: 'failed',
      attempts: 4,
      lastError: '400 invalid number',
      sentAt: null,
      deliveredAt: null,
      failedAt: '2026-11-10T08:02:00.000Z',
    };
    renderTab(scheduled(), {
      batches: [done],
      extra: {
        [`GET ${base}/batches/${done.id}/messages?page=1&pageSize=25`]: () =>
          jsonResponse(200, { items: [message], total: 1, page: 1, pageSize: 25 }),
        [`GET ${base}/batches/${done.id}/messages?page=1&pageSize=25&status=failed`]: () =>
          jsonResponse(200, { items: [message], total: 1, page: 1, pageSize: 25 }),
      },
    });
    const table = await screen.findByTestId('batch-table');
    await userEvent.click(within(table).getByText('Wapiga kura wote'));
    const drawer = await screen.findByRole('dialog');
    expect(await within(drawer).findByText('Asha Mwinyi')).toBeInTheDocument();
    expect(within(drawer).getByText('400 invalid number')).toBeInTheDocument();
    expect(within(drawer).getByText('Imeshindikana')).toBeInTheDocument();
    await userEvent.click(within(drawer).getByText('Zimeshindikana'));
    expect(await within(drawer).findByText('Asha Mwinyi')).toBeInTheDocument();
  });

  it('edits a template with chips, live preview and counter', async () => {
    const { calls } = renderTab(scheduled(), {
      extra: {
        [`POST ${base}/templates/preview`]: (body) => {
          const text = (body as { body: string }).body.replace('{voting_code}', 'K7M4-Q9XR');
          return jsonResponse(200, {
            text,
            subject: null,
            encoding: 'gsm7',
            characters: text.length,
            segments: text.length > 160 ? 2 : 1,
            unknownPlaceholders: [],
          });
        },
        [`PUT ${base}/templates`]: () => jsonResponse(200, templates()),
      },
    });
    const card = await screen.findByTestId('template-code_delivery');
    await userEvent.click(within(card).getByRole('button', { name: 'Hariri' }));
    const body = await screen.findByTestId('template-body');
    await userEvent.clear(body);
    await userEvent.type(body, 'Msimbo: ');
    await userEvent.click(screen.getByRole('button', { name: '{voting_code}' }));
    expect(body).toHaveValue('Msimbo: {voting_code}');
    expect(await screen.findByText('Msimbo: K7M4-Q9XR')).toBeInTheDocument();
    expect(screen.getByTestId('template-counter')).toHaveTextContent('17 / 160');

    await userEvent.type(body, ' {{code}');
    expect(await screen.findByRole('alert')).toHaveTextContent('{code}');
    expect(screen.getByTestId('template-save')).toBeDisabled();
    await userEvent.type(body, '{Backspace}'.repeat(7));
    await userEvent.click(screen.getByTestId('template-save'));
    await waitFor(() =>
      expect(calls.find((c) => c.method === 'PUT')?.body).toEqual({
        templates: [{ type: 'code_delivery', channel: 'sms', body: 'Msimbo: {voting_code}' }],
      }),
    );
  });

  it('is read-only without messages.send', async () => {
    renderTab(scheduled(), { permissions: ['event.view'], batches: [batch()] });
    expect(await screen.findByTestId('send-codes')).toBeDisabled();
    const card = await screen.findByTestId('template-code_delivery');
    expect(within(card).getByRole('button', { name: 'Tazama' })).toBeInTheDocument();
    expect(
      within(screen.getByTestId('batch-table')).queryByRole('button', {
        name: 'Tuma tena zilizoshindikana',
      }),
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId('schedule-save')).not.toBeInTheDocument();
  });

  it('saves the reminder schedule on the event', async () => {
    const { calls } = renderTab(scheduled(), {
      extra: { [`PATCH ${base}`]: () => jsonResponse(200, eventDetail('scheduled')) },
    });
    await userEvent.click(
      await screen.findByRole('switch', { name: 'Kumbusho kabla ya kufungwa' }),
    );
    await userEvent.click(screen.getByTestId('schedule-save'));
    await waitFor(() =>
      expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({
        reminderBeforeOpenHours: 24,
        reminderBeforeCloseMinutes: null,
      }),
    );
  });
});
