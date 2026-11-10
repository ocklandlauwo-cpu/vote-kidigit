import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { VoterImport } from '@vote-kidigit/shared';
import { App } from 'antd';
import { Outlet } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { upload } from '../../../api/client';
import { ME_KEY } from '../../../auth/useAuth';
import { jsonResponse, renderWithProviders, testQueryClient } from '../../../test/render';
import { EVENT_ID, eventDetail, me } from '../fixtures.test-utils';
import { ImportPage } from './ImportPage';
import { importResult } from './voters.test-utils';

vi.mock('../../../api/client', async (original) => ({
  ...(await original<typeof import('../../../api/client')>()),
  upload: vi.fn(),
}));
const uploadMock = vi.mocked(upload);

const IMPORT_ID = importResult().id;
/** rc-upload replaces its input after every choice, so it is looked up each time. */
const fileInput = () => document.querySelector('input[type=file]') as HTMLInputElement;
/** The input once the page has rendered it. */
const readyInput = () =>
  waitFor(() => {
    const input = fileInput();
    if (!input) throw new Error('no file input yet');
    return input;
  });
const csv = (name = 'wapiga.csv', bytes = 100) =>
  new File([new Uint8Array(bytes)], name, { type: 'text/csv' });

function renderPage(states: VoterImport[]) {
  let index = 0;
  const calls: { method: string; path: string }[] = [];
  vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const path = url.replace(/^\/api/, '');
    calls.push({ method, path });
    if (method === 'POST' && path.endsWith('/confirm')) {
      index = Math.min(index + 1, states.length - 1);
      return Promise.resolve(jsonResponse(200, states[index]));
    }
    if (path.startsWith(`/v1/events/${EVENT_ID}/imports/${IMPORT_ID}`)) {
      return Promise.resolve(jsonResponse(200, states[index]));
    }
    return Promise.resolve(jsonResponse(404, { code: 'NOT_FOUND', message: 'x' }));
  });
  uploadMock.mockResolvedValue({ id: IMPORT_ID });
  const queryClient = testQueryClient();
  queryClient.setQueryData(ME_KEY, me(['event.view', 'voter.view', 'voter.manage']));
  const view = renderWithProviders(<p />, {
    path: '/start',
    queryClient,
    routes: [
      {
        path: '/voters/import',
        element: (
          <App>
            <Outlet context={eventDetail('draft')} />
          </App>
        ),
        children: [{ index: true, element: <ImportPage /> }],
      },
    ],
  });
  void view.router.navigate('/voters/import');
  return { ...view, calls, advance: () => (index = Math.min(index + 1, states.length - 1)) };
}

describe('EVT-06 CSV import', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    uploadMock.mockReset();
  });

  it('previews the counters and reasons, then imports the rows without errors', async () => {
    const { calls } = renderPage([
      importResult(),
      importResult({ status: 'completed', importedRows: 2 }),
    ]);
    await userEvent.upload(await readyInput(), csv());
    expect(uploadMock.mock.calls[0]?.[0]).toBe(`/v1/events/${EVENT_ID}/imports`);
    const counters = await screen.findByTestId('import-counters');
    expect(counters).toHaveTextContent('Tayari1');
    expect(counters).toHaveTextContent('Tahadhari1');
    expect(counters).toHaveTextContent('Makosa2');
    expect(await screen.findByText('Namba ya uanachama tayari ipo')).toBeInTheDocument();
    expect(screen.getByText('Namba ya simu si sahihi')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Pakua mistari yenye makosa/ })).toHaveAttribute(
      'href',
      `/api/v1/events/${EVENT_ID}/imports/${IMPORT_ID}/errors.csv`,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Ingiza wapiga kura 2' }));
    await waitFor(() => expect(calls.some((c) => c.path.endsWith('/confirm'))).toBe(true));
    expect(await screen.findByText('Wapiga kura 2 wameingizwa.')).toBeInTheDocument();
    expect(screen.getByText('Mistari 2 yenye makosa imerukwa.')).toBeInTheDocument();
  });

  it('names the missing columns', async () => {
    renderPage([
      importResult({
        status: 'failed',
        failureReason: 'missing_columns',
        missingColumns: ['membership_id', 'gender'],
      }),
    ]);
    await userEvent.upload(await readyInput(), csv());
    expect(
      await screen.findByText(
        'Faili halina safu wima hizi: membership_id, gender. Pakua kiolezo, kisha jaribu tena.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Pakia faili jingine/ })).toBeInTheDocument();
  });

  it('refuses other files and files over 10 MB before uploading', async () => {
    const user = userEvent.setup({ applyAccept: false });
    renderPage([importResult()]);
    await user.upload(await readyInput(), csv('wapiga.xlsx'));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Tumia faili la .csv chini ya MB 10',
    );
    await user.upload(fileInput(), csv('wapiga.csv', 10 * 1024 * 1024 + 1));
    expect(uploadMock).not.toHaveBeenCalled();
  });

  it('cannot import a file with only errors', async () => {
    renderPage([importResult({ validRows: 0, warningRows: 0, errorRows: 4 })]);
    await userEvent.upload(await readyInput(), csv());
    expect(
      await screen.findByRole('button', { name: 'Rekebisha makosa, kisha pakia tena' }),
    ).toBeDisabled();
  });
});
