import { render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it } from 'vitest';
import { routes } from '../router';

describe('staff router', () => {
  it('renders the placeholder page at the root route', () => {
    const router = createMemoryRouter(routes, { initialEntries: ['/'] });
    render(<RouterProvider router={router} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Vote-Kidigit' })).toBeInTheDocument();
  });
});
