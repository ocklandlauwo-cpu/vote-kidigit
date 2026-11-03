import { createBrowserRouter, type RouteObject } from 'react-router';
import { PlaceholderPage } from './pages/PlaceholderPage';

// React Router 7 in data mode (Tech Stack 7). The App Flow routes replace the placeholder from
// step 13. The component gallery exists only in development: import.meta.env.DEV is false in
// production builds, so the route and its lazy chunk are removed entirely.
export const routes: RouteObject[] = [
  { path: '/', element: <PlaceholderPage /> },
  ...(import.meta.env.DEV
    ? [
        {
          path: '/dev/components',
          lazy: async () => ({ Component: (await import('./dev/ComponentGallery')).default }),
        },
      ]
    : []),
];

export const router = createBrowserRouter(routes, { basename: '/app' });
