import { render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it } from 'vitest';
import '../i18n';
import { routes } from '../router';

describe('voter router', () => {
  it.each([
    ['/', 'PUB-01'],
    ['/results/abc123', 'RES-04'],
  ])('renders the placeholder for %s', (path, screenId) => {
    const router = createMemoryRouter(routes, { initialEntries: [path] });
    render(<RouterProvider router={router} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Vote-Kidigit' })).toBeInTheDocument();
    expect(screen.getByRole('main')).toHaveAttribute('data-screen-id', screenId);
  });

  it('loads the sign-in page for /vote', async () => {
    const router = createMemoryRouter(routes, { initialEntries: ['/vote'] });
    render(<RouterProvider router={router} />);
    // The page is a lazy chunk: its first import can take a while when every suite runs at once.
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Ingia' }, { timeout: 5000 }),
    ).toBeInTheDocument();
  });
});
