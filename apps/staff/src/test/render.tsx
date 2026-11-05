// Renders a component with the app's providers: a fresh query client, i18next (Swahili unless a
// test switches) and a memory router.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, type RenderResult } from '@testing-library/react';
import type { ReactElement } from 'react';
import { I18nextProvider } from 'react-i18next';
import { createMemoryRouter, RouterProvider, type RouteObject } from 'react-router';
import { i18n } from '../i18n';

export function testQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

export function renderWithProviders(
  ui: ReactElement,
  {
    path = '/',
    routes,
    queryClient = testQueryClient(),
  }: {
    path?: string;
    /** Extra routes next to the one rendering `ui` at `path` (e.g. targets of navigation). */
    routes?: RouteObject[];
    queryClient?: QueryClient;
  } = {},
): RenderResult & { router: ReturnType<typeof createMemoryRouter>; queryClient: QueryClient } {
  const router = createMemoryRouter(
    [{ path: path.split('?')[0], element: ui }, ...(routes ?? [])],
    { initialEntries: [path] },
  );
  const result = render(
    <QueryClientProvider client={queryClient}>
      <I18nextProvider i18n={i18n}>
        <RouterProvider router={router} />
      </I18nextProvider>
    </QueryClientProvider>,
  );
  return { ...result, router, queryClient };
}

/** A JSON fetch response for vi.stubGlobal('fetch', …). */
export function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}
