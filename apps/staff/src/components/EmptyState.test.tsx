import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '../test/render';
import { EmptyState, type EmptyStateKind } from './EmptyState';

const ICONS: [EmptyStateKind, string][] = [
  ['list', 'inbox'],
  ['noMatch', 'search'],
  ['events', 'calendar'],
  ['users', 'team'],
];

describe('EmptyState', () => {
  it.each(ICONS)('%s shows the %s icon, title and description', async (kind, icon) => {
    const { container } = renderWithProviders(
      <EmptyState
        kind={kind}
        title="Hakuna wapiga kura"
        description="Pakia CSV au ongeza mmoja mmoja."
      />,
    );
    expect(
      await screen.findByRole('heading', { level: 3, name: 'Hakuna wapiga kura' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Pakia CSV au ongeza mmoja mmoja.')).toBeInTheDocument();
    expect(container.querySelector(`[aria-label="${icon}"]`)).not.toBeNull();
  });

  it('shows the primary action when given', async () => {
    const onClick = vi.fn();
    renderWithProviders(
      <EmptyState
        kind="events"
        title="Hakuna chaguzi"
        action={{ label: 'Unda uchaguzi', onClick }}
      />,
    );
    const button = await screen.findByRole('button', { name: 'Unda uchaguzi' });
    expect(button).toHaveClass('ant-btn-primary');
    await userEvent.click(button);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('has no button without permission (no action given)', async () => {
    renderWithProviders(<EmptyState kind="events" title="Hakuna chaguzi" />);
    await screen.findByText('Hakuna chaguzi');
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('offers Clear filters for no matches only', async () => {
    const onClear = vi.fn();
    const { unmount } = renderWithProviders(
      <EmptyState
        kind="noMatch"
        title="Hakuna kinacholingana"
        onClearFilters={onClear}
        clearFiltersLabel="Futa vichujio"
      />,
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Futa vichujio' }));
    expect(onClear).toHaveBeenCalledOnce();
    unmount();

    renderWithProviders(
      <EmptyState
        kind="list"
        title="Tupu"
        onClearFilters={onClear}
        clearFiltersLabel="Futa vichujio"
      />,
    );
    await screen.findByText('Tupu');
    expect(screen.queryByRole('button', { name: 'Futa vichujio' })).toBeNull();
  });
});
