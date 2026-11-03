import { createBrowserRouter, type RouteObject } from 'react-router';
import { PlaceholderPage } from './pages/PlaceholderPage';

// React Router 7 in data mode (Tech Stack 7). The App Flow routes replace this from step 13.
export const routes: RouteObject[] = [{ path: '/', element: <PlaceholderPage /> }];

export const router = createBrowserRouter(routes, { basename: '/app' });
