import { screen } from '@testing-library/react';
import type { MeResponse, PermissionKey } from '@vote-kidigit/shared';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { i18n } from '../i18n';
import { routes } from '../router';
import { jsonResponse, testQueryClient } from '../test/render';

function me(permissions: PermissionKey[], isPlatformAdmin = false): MeResponse {
  return {
    id: '0190f0a1-2b3c-7d4e-8f90-123456789abc',
    email: 'neema@example.test',
    fullName: 'Neema Mushi',
    phone: null,
    language: 'sw',
    themePreference: 'system',
    isPlatformAdmin,
    isOrgSuperAdmin: false,
    organization: isPlatformAdmin
      ? null
      : {
          id: '0190f0a1-2b3c-7d4e-8f90-123456789abd',
          name: 'Chama cha Walimu',
          slug: 'chama-cha-walimu',
          timeZone: 'Africa/Dar_es_Salaam',
          primaryColor: null,
          sessionTimeoutMinutes: 15,
        },
    role: null,
    permissions,
    mappedEventIds: [],
    csrfToken: 'c',
    sessionExpiresAt: new Date(Date.now() + 900_000).toISOString(),
  };
}

function renderApp(path: string, meResponse: Response) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(meResponse));
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(
    <QueryClientProvider client={testQueryClient()}>
      <I18nextProvider i18n={i18n}>
        <RouterProvider router={router} />
      </I18nextProvider>
    </QueryClientProvider>,
  );
  return router;
}

describe('route guards', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('sends signed-out users to sign-in, remembering where they were going', async () => {
    const router = renderApp(
      '/users',
      jsonResponse(401, { code: 'UNAUTHENTICATED', message: 'x' }),
    );
    expect(await screen.findByRole('heading', { level: 1, name: 'Ingia' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/login');
    expect(router.state.location.search).toBe('?returnTo=%2Fusers');
  });

  it('shows the portal frame and dashboard to signed-in staff', async () => {
    // A desktop-wide screen: the sidebar is shown, not hidden in the mobile drawer.
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: true,
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
    }));
    renderApp('/', jsonResponse(200, me(['event.view'])));
    expect(await screen.findByRole('heading', { level: 1, name: 'Dashibodi' })).toBeInTheDocument();
    expect(screen.getByText('Chama cha Walimu')).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /Chaguzi/ })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: /Watumiaji/ })).toBeNull();
  });

  it('answers ERR-03 for a section without permission, as if it did not exist', async () => {
    renderApp('/users', jsonResponse(200, me(['event.view'])));
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Hatukuweza kupata ukurasa huo' }),
    ).toBeInTheDocument();
  });

  it('opens a section the user may use', async () => {
    renderApp('/users', jsonResponse(200, me(['staff.manage'])));
    expect(await screen.findByRole('heading', { level: 1, name: 'Watumiaji' })).toBeInTheDocument();
  });

  it('answers ERR-03 for unknown pages', async () => {
    renderApp('/no-such-page', jsonResponse(200, me([])));
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Hatukuweza kupata ukurasa huo' }),
    ).toBeInTheDocument();
  });

  it('shows ERR-01 when offline and ERR-05 on a server error, with Retry', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')));
    const router = createMemoryRouter(routes, { initialEntries: ['/'] });
    const view = render(
      <QueryClientProvider client={testQueryClient()}>
        <I18nextProvider i18n={i18n}>
          <RouterProvider router={router} />
        </I18nextProvider>
      </QueryClientProvider>,
    );
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Hakuna mtandao' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Jaribu tena' })).toBeInTheDocument();
    view.unmount();

    renderApp('/', jsonResponse(500, { code: 'INTERNAL', message: 'x' }));
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Kuna hitilafu upande wetu' }),
    ).toBeInTheDocument();
  });

  it('takes signed-in users past the sign-in page', async () => {
    const router = renderApp('/login', jsonResponse(200, me([])));
    expect(await screen.findByRole('heading', { level: 1, name: 'Dashibodi' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/');
  });
});
