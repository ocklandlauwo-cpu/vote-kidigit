import type { ComponentType } from 'react';
import { createBrowserRouter, type RouteObject } from 'react-router';
import { PlaceholderPage } from './pages/PlaceholderPage';

// React Router 7 in data mode (Tech Stack 7). Public site, voter flow and results pages
// become separate lazy-loaded chunks as they are built (steps 24, 27, 38). The component
// gallery exists only in development: import.meta.env.DEV is false in production builds,
// so the route and its lazy chunk are removed entirely.
/** A lazily loaded page: each voter screen is its own chunk (Tech Stack 7.2). */
function page(path: string, load: () => Promise<{ default: ComponentType }>): RouteObject {
  return {
    path,
    lazy: async () => ({ Component: (await load()).default }),
    // Shown for the moment the page chunk loads on the first visit.
    HydrateFallback: () => <div className="min-h-dvh bg-bg" />,
  };
}

export const routes: RouteObject[] = [
  { path: '/', element: <PlaceholderPage screenId="PUB-01" /> },
  page('/vote', () => import('./pages/vote/SignInPage')),
  page('/vote/:eventId', () => import('./pages/vote/SignInPage')),
  page('/vote/:eventId/identity', () => import('./pages/vote/IdentityPage')),
  page('/vote/:eventId/status', () => import('./pages/vote/StatusPage')),
  page('/vote/:eventId/ballot/:index', () => import('./pages/vote/CategoryPage')),
  page('/vote/:eventId/review', () => import('./pages/vote/ReviewPage')),
  page('/vote/:eventId/received', () => import('./pages/vote/ReceivedPage')),
  { path: '/results/:token', element: <PlaceholderPage screenId="RES-04" /> },
  ...(import.meta.env.DEV
    ? [
        {
          path: '/dev/components',
          lazy: async () => ({ Component: (await import('./dev/ComponentGallery')).default }),
        },
      ]
    : []),
];

export const router = createBrowserRouter(routes);
