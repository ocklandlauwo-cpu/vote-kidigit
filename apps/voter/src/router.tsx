import type { ComponentType } from 'react';
import { createBrowserRouter, type NonIndexRouteObject, type RouteObject } from 'react-router';

// React Router 7 in data mode (Tech Stack 7). Public site, voter flow and results pages are
// separate lazy-loaded chunks (steps 24, 27, 38). The component
// gallery exists only in development: import.meta.env.DEV is false in production builds,
// so the route and its lazy chunk are removed entirely.
/** A lazily loaded page: each voter screen is its own chunk (Tech Stack 7.2). */
function page(path: string, load: () => Promise<{ default: ComponentType }>): NonIndexRouteObject {
  return {
    path,
    lazy: async () => ({ Component: (await load()).default }),
    // Shown for the moment the page chunk loads on the first visit.
    HydrateFallback: () => <div className="min-h-dvh bg-bg" />,
  };
}

/** The same, as the index route of a layout. */
function indexPage(load: () => Promise<{ default: ComponentType }>): RouteObject {
  return {
    index: true,
    lazy: async () => ({ Component: (await load()).default }),
    HydrateFallback: () => <div className="min-h-dvh bg-bg" />,
  };
}

export const routes: RouteObject[] = [
  {
    // Public website (App Flow 4.1): PUB-01 to PUB-05 share the site header and footer.
    ...page('/', () => import('./pages/public/PublicLayout')),
    children: [
      indexPage(() => import('./pages/public/HomePage')),
      page('features', () => import('./pages/public/FeaturesPage')),
      page('pricing', () => import('./pages/public/PricingPage')),
      page('contact', () => import('./pages/public/ContactPage')),
      page('demo', () => import('./pages/public/DemoPage')),
    ],
  },
  page('/vote', () => import('./pages/vote/SignInPage')),
  page('/vote/:eventId', () => import('./pages/vote/SignInPage')),
  page('/vote/:eventId/identity', () => import('./pages/vote/IdentityPage')),
  page('/vote/:eventId/status', () => import('./pages/vote/StatusPage')),
  page('/vote/:eventId/ballot/:index', () => import('./pages/vote/CategoryPage')),
  page('/vote/:eventId/review', () => import('./pages/vote/ReviewPage')),
  page('/vote/:eventId/received', () => import('./pages/vote/ReceivedPage')),
  page('/vote/:eventId/results', () => import('./pages/vote/VoterResultsPage')),
  {
    // Kiosk mode (App Flow 10): the shared ballot screens under the device's token.
    ...page('/vote/kiosk/:kioskToken', () => import('./pages/vote/kiosk/KioskLayout')),
    children: [
      indexPage(() => import('./pages/vote/kiosk/KioskStartPage')),
      page('identity', () => import('./pages/vote/IdentityPage')),
      page('status', () => import('./pages/vote/StatusPage')),
      page('ballot/:index', () => import('./pages/vote/CategoryPage')),
      page('review', () => import('./pages/vote/ReviewPage')),
      page('received', () => import('./pages/vote/ReceivedPage')),
      page('results', () => import('./pages/vote/VoterResultsPage')),
    ],
  },
  page('/results/:token', () => import('./pages/results/PublicResultsPage')),
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
