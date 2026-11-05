import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { MeResponse } from '@vote-kidigit/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { session } from '../../api/session';
import { jsonResponse, renderWithProviders } from '../../test/render';
import { SignInPage } from './SignInPage';

const ME: MeResponse = {
  id: '0190f0a1-2b3c-7d4e-8f90-123456789abc',
  email: 'neema@example.test',
  fullName: 'Neema Mushi',
  phone: null,
  language: 'sw',
  themePreference: 'system',
  isPlatformAdmin: false,
  isOrgSuperAdmin: true,
  organization: null,
  role: null,
  permissions: [],
  mappedEventIds: [],
  csrfToken: 'csrf-123',
  sessionExpiresAt: new Date(Date.now() + 900_000).toISOString(),
};

function stubLogin(response: Response) {
  const fetchMock = vi.fn().mockResolvedValue(response);
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

async function submit(email = 'neema@example.test', password = 'Uchaguzi2027') {
  await userEvent.type(await screen.findByLabelText('Barua pepe'), email);
  await userEvent.type(screen.getByLabelText('Nenosiri'), password);
  await userEvent.click(screen.getByRole('button', { name: 'Ingia' }));
}

function renderPage(path = '/login') {
  return renderWithProviders(<SignInPage />, {
    path,
    routes: [
      { path: '/', element: <p>dashboard</p> },
      { path: '/users', element: <p>users page</p> },
    ],
  });
}

describe('AUTH-01 sign in', () => {
  beforeEach(() => session.clear());
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('signs in, keeps the CSRF token and goes to the page asked for', async () => {
    const fetchMock = stubLogin(jsonResponse(200, ME));
    renderPage('/login?returnTo=%2Fusers');
    await submit();
    expect(await screen.findByText('users page')).toBeInTheDocument();
    expect(session.get().csrfToken).toBe('csrf-123');
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/v1/auth/login');
    expect(JSON.parse(init.body as string)).toEqual({
      email: 'neema@example.test',
      password: 'Uchaguzi2027',
    });
  });

  it('never goes to another site after sign-in', async () => {
    stubLogin(jsonResponse(200, ME));
    renderPage('/login?returnTo=https%3A%2F%2Fevil.example');
    await submit();
    expect(await screen.findByText('dashboard')).toBeInTheDocument();
  });

  it('says email or password is incorrect without saying which, and clears the password', async () => {
    stubLogin(jsonResponse(401, { code: 'INVALID_CREDENTIALS', message: 'x' }));
    renderPage();
    await submit();
    expect(await screen.findByRole('alert')).toHaveTextContent('Barua pepe au nenosiri si sahihi.');
    expect(screen.getByLabelText('Nenosiri')).toHaveValue('');
  });

  it('shows the lockout with a countdown', async () => {
    const lockedUntil = new Date(Date.now() + 14 * 60_000 + 30_000).toISOString();
    stubLogin(
      jsonResponse(423, { code: 'ACCOUNT_LOCKED', message: 'x', details: { lockedUntil } }),
    );
    renderPage();
    await submit();
    expect(await screen.findByRole('alert')).toHaveTextContent(
      /Akaunti imefungwa kwa dakika 15\. Jaribu tena baada ya 14:(30|29)\./,
    );
  });

  it.each([
    ['ACCOUNT_INACTIVE', 403, 'Akaunti yako haitumiki. Wasiliana na msimamizi wako.'],
    ['ORG_SUSPENDED', 403, 'Huduma ya shirika lako imesimamishwa.'],
    ['RATE_LIMITED', 429, 'Majaribio ni mengi mno. Subiri dakika moja, kisha jaribu tena.'],
  ])('%s: %s', async (code, status, text) => {
    stubLogin(jsonResponse(status, { code, message: 'x' }));
    renderPage();
    await submit();
    expect(await screen.findByRole('alert')).toHaveTextContent(text);
  });

  it('says when the connection is gone', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    renderPage();
    await submit();
    expect(await screen.findByRole('alert')).toHaveTextContent('Hakuna mtandao.');
  });

  it('validates the email before sending', async () => {
    const fetchMock = stubLogin(jsonResponse(200, ME));
    renderPage();
    await submit('not-an-email');
    expect(await screen.findByText('Andika barua pepe kama jina@mfano.co.tz')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ['inactive', 'Umetolewa kwa sababu ya kutotumika.'],
    ['signedOut', 'Umetoka.'],
    ['passwordSaved', 'Nenosiri limehifadhiwa. Ingia kwa nenosiri jipya.'],
  ])('explains why the user is here (reason=%s)', async (reason, text) => {
    renderPage(`/login?reason=${reason}`);
    expect(await screen.findByText(text)).toBeInTheDocument();
  });

  it('links to forgot password and the voter app', async () => {
    renderPage();
    expect(await screen.findByRole('link', { name: 'Umesahau nenosiri?' })).toHaveAttribute(
      'href',
      '/forgot',
    );
    expect(
      screen.getByRole('link', { name: 'Wewe ni mpiga kura? Piga kura hapa' }),
    ).toHaveAttribute('href', '/vote');
    await waitFor(() => expect(screen.getByLabelText('Barua pepe')).toHaveFocus());
  });
});
