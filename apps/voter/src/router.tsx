import { createBrowserRouter, type RouteObject } from 'react-router';
import { PlaceholderPage } from './pages/PlaceholderPage';

// React Router 7 in data mode (Tech Stack 7). Public site, voter flow and results pages
// become separate lazy-loaded chunks as they are built (steps 24, 27, 38).
export const routes: RouteObject[] = [
  { path: '/', element: <PlaceholderPage screenId="PUB-01" /> },
  { path: '/vote', element: <PlaceholderPage screenId="VTR-WEB-01" /> },
  { path: '/results/:token', element: <PlaceholderPage screenId="RES-04" /> },
];

export const router = createBrowserRouter(routes);
