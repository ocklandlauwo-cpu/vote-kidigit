// Test helpers for the voter flow: fixtures, a fetch stub and a router render.
import { render } from '@testing-library/react';
import type { VoterStatus } from '@vote-kidigit/shared';
import type { ComponentType } from 'react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { vi } from 'vitest';
import '../i18n';
import { card, identity } from '../dev/fixtures';
import { resetVote, setVoteState } from '../vote/store';

export function status(change: Partial<VoterStatus> = {}): VoterStatus {
  return { event: card(), categories: [], canVote: false, votedAt: null, ...change };
}

/** Starts a signed-in visit in the store. */
export function signedIn(extra: Parameters<typeof setVoteState>[0] = {}): void {
  resetVote();
  setVoteState({ token: 't'.repeat(43), identity, event: card(), ...extra });
}

export function jsonResponse(status: number, body: unknown): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export interface Call {
  method: string;
  path: string;
  body: unknown;
}

/** fetch answering "METHOD /path" from `routes`; unknown requests answer 404. */
export function stubFetch(routes: Record<string, (body: unknown) => Response>): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const path = url.replace(/^\/api/, '');
    const body: unknown = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    calls.push({ method, path, body });
    const handler = routes[`${method} ${path}`];
    return Promise.resolve(
      handler ? handler(body) : jsonResponse(404, { code: 'NOT_FOUND', message: 'x' }),
    );
  });
  return calls;
}

/** Renders the voter routes at `path`. */
export function renderAt(path: string, pages: Record<string, ComponentType>) {
  const router = createMemoryRouter(
    Object.entries(pages).map(([routePath, Page]) => ({ path: routePath, Component: Page })),
    { initialEntries: [path] },
  );
  return { router, ...render(<RouterProvider router={router} />) };
}
