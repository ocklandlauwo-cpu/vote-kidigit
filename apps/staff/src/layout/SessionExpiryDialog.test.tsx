import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { MeResponse } from '@vote-kidigit/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { session } from '../api/session';
import { jsonResponse, renderWithProviders } from '../test/render';
import { SessionExpiryDialog } from './SessionExpiryDialog';

const ME = {
  id: '0190f0a1-2b3c-7d4e-8f90-123456789abc',
  email: 'a@example.test',
  fullName: 'A B',
  phone: null,
  language: 'sw',
  themePreference: 'system',
  isPlatformAdmin: false,
  isOrgSuperAdmin: false,
  organization: null,
  role: null,
  permissions: [],
  mappedEventIds: [],
  csrfToken: 'c',
  sessionExpiresAt: new Date().toISOString(),
} satisfies MeResponse;

function renderDialog() {
  return renderWithProviders(<SessionExpiryDialog />, {
    path: '/',
    routes: [{ path: '/login', element: <p>sign-in page</p> }],
  });
}

describe('AUTH-05 session expiry', () => {
  beforeEach(() => session.clear());
  afterEach(() => {
    vi.unstubAllGlobals();
    session.clear();
  });

  it('stays hidden while more than 60 seconds remain', () => {
    session.setExpiresAt(new Date(Date.now() + 5 * 60_000).toISOString());
    renderDialog();
    expect(screen.queryByText('Bado upo?')).toBeNull();
  });

  it('warns with a countdown in the last 60 seconds; staying renews the session', async () => {
    session.setExpiresAt(new Date(Date.now() + 45_000).toISOString());
    const renewed = new Date(Date.now() + 15 * 60_000).toISOString();
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(200, ME, { 'X-Session-Expires': renewed }));
    vi.stubGlobal('fetch', fetchMock);
    renderDialog();
    expect(await screen.findByText('Bado upo?')).toBeInTheDocument();
    expect(screen.getByRole('timer')).toHaveTextContent(
      /Utatolewa baada ya sekunde (45|44) kwa sababu ya kutotumika\./,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Endelea kuwa ndani' }));
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/me', expect.anything());
    expect(session.get().expiresAt).toBe(Date.parse(renewed));
  });

  it('returns to sign-in when the time runs out', async () => {
    session.setExpiresAt(new Date(Date.now() + 1_000).toISOString());
    const { router } = renderDialog();
    await act(() => new Promise((resolve) => setTimeout(resolve, 2_100)));
    expect(await screen.findByText('sign-in page')).toBeInTheDocument();
    expect(router.state.location.search).toBe('?reason=inactive');
    expect(session.get().expiresAt).toBeNull();
  });

  it('can sign out from the warning', async () => {
    session.setExpiresAt(new Date(Date.now() + 30_000).toISOString());
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    const { router } = renderDialog();
    await userEvent.click(await screen.findByRole('button', { name: 'Toka' }));
    expect(await screen.findByText('sign-in page')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/auth/logout',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(router.state.location.search).toBe('?reason=signedOut');
  });
});
