// Report downloads on the staff screens (App Flow 11.3, 13): the results PDF downloads at once
// for a small event; a queued one shows "Tunaandaa PDF…" until the worker is done and then
// downloads; a failure offers Retry; recent downloads list the event's reports; the audit export
// takes the screen's filters.
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { EventResults, PermissionKey, ReportJob } from '@vote-kidigit/shared';
import { App } from 'antd';
import { Outlet } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ME_KEY } from '../../auth/useAuth';
import { jsonResponse, renderWithProviders, routeFetch, testQueryClient } from '../../test/render';
import { AuditView } from '../audit/AuditPage';
import { EVENT_ID, eventDetail, me } from '../events/fixtures.test-utils';
import { ResultsTab } from '../events/results/ResultsTab';
import { startDownload } from './download';

vi.mock('./download', () => ({ startDownload: vi.fn() }));

const JOB = '0190f0a1-2b3c-7d4e-8f90-0000000009a1';
const FILE_URL = '/api/v1/files/0190f0a1-2b3c-7d4e-8f90-0000000009f1';

function job(change: Partial<ReportJob> = {}): ReportJob {
  return {
    id: JOB,
    type: 'results_pdf',
    status: 'completed',
    progress: 100,
    downloadUrl: FILE_URL,
    fileName: 'matokeo-uchaguzi-2026-11-20.pdf',
    requestedBy: 'Neema Mushi',
    error: null,
    createdAt: '2026-11-20T13:10:00.000Z',
    completedAt: '2026-11-20T13:10:02.000Z',
    ...change,
  };
}

const closedResults: EventResults = {
  state: 'closed',
  unresolvedTies: 0,
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
    categories: [],
  },
};

const ALL: PermissionKey[] = ['event.view', 'results.view', 'results.publish', 'reports.download'];

function renderResults(
  routes: Record<string, (body: unknown) => Response>,
  permissions: PermissionKey[] = ALL,
) {
  const { fetch, calls } = routeFetch({
    [`GET /v1/events/${EVENT_ID}/results`]: () => jsonResponse(200, closedResults),
    [`GET /v1/events/${EVENT_ID}/reports`]: () => jsonResponse(200, []),
    ...routes,
  });
  vi.stubGlobal('fetch', fetch);
  const queryClient = testQueryClient();
  queryClient.setQueryData(ME_KEY, me(permissions));
  const view = renderWithProviders(<p />, {
    path: '/start',
    queryClient,
    routes: [
      {
        path: '/results',
        element: (
          <App>
            <Outlet context={eventDetail('closed')} />
          </App>
        ),
        children: [{ index: true, element: <ResultsTab /> }],
      },
    ],
  });
  void view.router.navigate('/results');
  return { calls };
}

describe('report downloads', () => {
  beforeEach(() => vi.mocked(startDownload).mockClear());
  afterEach(() => vi.unstubAllGlobals());

  it('downloads the results PDF at once for a small event and lists it', async () => {
    let recent: ReportJob[] = [];
    const { calls } = renderResults({
      [`POST /v1/events/${EVENT_ID}/reports`]: () => {
        recent = [job()];
        return jsonResponse(200, job());
      },
      [`GET /v1/events/${EVENT_ID}/reports`]: () => jsonResponse(200, recent),
    });
    // The whole suite runs in parallel: allow the first render more than the default second.
    expect(
      await screen.findByText('Bado hakuna ripoti iliyopakuliwa.', {}, { timeout: 5_000 }),
    ).toBeInTheDocument();
    await userEvent.click(await screen.findByTestId('download-pdf', {}, { timeout: 5_000 }));
    await waitFor(() => expect(startDownload).toHaveBeenCalledWith(FILE_URL));
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ type: 'results_pdf' });
    expect(await screen.findByText('Matokeo (PDF)')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Pakua Matokeo (PDF)' })).toHaveAttribute(
      'href',
      FILE_URL,
    );
  });

  it('shows "Tunaandaa PDF…" for a large event, then downloads when ready', async () => {
    let polls = 0;
    renderResults({
      [`POST /v1/events/${EVENT_ID}/reports`]: () =>
        jsonResponse(202, job({ status: 'queued', progress: 0, downloadUrl: null })),
      [`GET /v1/events/${EVENT_ID}/reports/${JOB}`]: () => {
        polls += 1;
        return jsonResponse(
          200,
          polls < 2 ? job({ status: 'running', progress: 50, downloadUrl: null }) : job(),
        );
      },
    });
    await userEvent.click(await screen.findByTestId('download-pdf', {}, { timeout: 5_000 }));
    expect(await screen.findByTestId('report-preparing')).toHaveTextContent('Tunaandaa PDF…');
    await waitFor(() => expect(startDownload).toHaveBeenCalledWith(FILE_URL), { timeout: 8_000 });
    expect(screen.queryByTestId('report-preparing')).not.toBeInTheDocument();
  }, 15_000);

  it('says the PDF failed and tries again on Retry', async () => {
    let attempts = 0;
    renderResults({
      [`POST /v1/events/${EVENT_ID}/reports`]: () => {
        attempts += 1;
        return jsonResponse(
          200,
          attempts === 1 ? job({ status: 'failed', downloadUrl: null, error: 'INTERNAL' }) : job(),
        );
      },
    });
    await userEvent.click(await screen.findByTestId('download-pdf', {}, { timeout: 5_000 }));
    expect(await screen.findByText('Hatukuweza kuandaa PDF. Jaribu tena.')).toBeInTheDocument();
    expect(startDownload).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Jaribu tena' }));
    await waitFor(() => expect(startDownload).toHaveBeenCalledWith(FILE_URL));
  });

  it('opens with ?download=pdf from the header and starts the PDF once', async () => {
    const { fetch, calls } = routeFetch({
      [`GET /v1/events/${EVENT_ID}/results`]: () => jsonResponse(200, closedResults),
      [`GET /v1/events/${EVENT_ID}/reports`]: () => jsonResponse(200, []),
      [`POST /v1/events/${EVENT_ID}/reports`]: () => jsonResponse(200, job()),
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
              <Outlet context={eventDetail('results_published')} />
            </App>
          ),
          children: [{ index: true, element: <ResultsTab /> }],
        },
      ],
    });
    void view.router.navigate('/results?download=pdf');
    await waitFor(() => expect(startDownload).toHaveBeenCalledTimes(1));
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(1);
    expect(view.router.state.location.search).toBe('');
  });

  it('says when voting closed with no ballots, with Download PDF', async () => {
    renderResults({
      [`GET /v1/events/${EVENT_ID}/results`]: () =>
        jsonResponse(200, {
          ...closedResults,
          snapshot: closedResults.snapshot && { ...closedResults.snapshot, votersVoted: 0 },
        }),
      [`POST /v1/events/${EVENT_ID}/reports`]: () => jsonResponse(200, job()),
    });
    expect(
      await screen.findByText(
        'Upigaji kura umefungwa bila kura yoyote kupigwa.',
        {},
        { timeout: 5_000 },
      ),
    ).toBeInTheDocument();
    await userEvent.click(
      screen.getAllByRole('button', { name: /Pakua PDF/ }).at(-1) as HTMLElement,
    );
    await waitFor(() => expect(startDownload).toHaveBeenCalledWith(FILE_URL));
  });

  it('greys Download PDF without reports.download', async () => {
    renderResults({}, ['event.view', 'results.view']);
    expect(await screen.findByTestId('download-pdf')).toBeDisabled();
    expect(screen.queryByText('Vilivyopakuliwa hivi karibuni')).not.toBeInTheDocument();
  });

  it('exports the event activity with the current filters', async () => {
    const { fetch, calls } = routeFetch({
      [`GET /v1/events/${EVENT_ID}/audit?action=event.&page=1&pageSize=50`]: () =>
        jsonResponse(200, { items: [], total: 0, page: 1, pageSize: 50 }),
      [`POST /v1/events/${EVENT_ID}/audit/exports`]: () =>
        jsonResponse(200, job({ type: 'audit_xlsx', fileName: 'kumbukumbu.xlsx' })),
    });
    vi.stubGlobal('fetch', fetch);
    const queryClient = testQueryClient();
    queryClient.setQueryData(ME_KEY, me(['event.view', 'audit.view.event']));
    renderWithProviders(
      <App>
        <AuditView endpoint={`/v1/events/${EVENT_ID}/audit`} exportEventId={EVENT_ID} />
      </App>,
      { path: '/activity?action=event.', queryClient },
    );
    await userEvent.click(await screen.findByRole('button', { name: /Pakua Excel/ }));
    await waitFor(() => expect(startDownload).toHaveBeenCalledWith(FILE_URL));
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({
      filters: { action: 'event.' },
    });
  });
});
