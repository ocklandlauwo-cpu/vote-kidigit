import { render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it } from 'vitest';
import { routes } from '../router';

describe('voter router', () => {
  it.each([
    ['/', 'PUB-01'],
    ['/vote', 'VTR-WEB-01'],
    ['/results/abc123', 'RES-04'],
  ])('renders the placeholder for %s', (path, screenId) => {
    const router = createMemoryRouter(routes, { initialEntries: [path] });
    render(<RouterProvider router={router} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Vote-Kidigit' })).toBeInTheDocument();
    expect(screen.getByRole('main')).toHaveAttribute('data-screen-id', screenId);
  });
});
