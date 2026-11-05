import { screen } from '@testing-library/react';
import { Button } from 'antd';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '../test/render';
import { PageHeader } from './PageHeader';
import { StatusBadge } from './StatusBadge';

function stubWidth(desktop: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: desktop,
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
  }));
}

describe('PageHeader', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('shows the title as h1 with a status badge, meta line and actions', async () => {
    renderWithProviders(
      <PageHeader
        title="AGM 2027"
        status={<StatusBadge domain="event" value="draft" />}
        meta={['3 Nov 2026, saa 08:00 – 16:00', null, 'Chama cha Walimu']}
        actions={
          <>
            <Button>Hakiki</Button>
            <Button type="primary">Chapisha</Button>
          </>
        }
      />,
    );
    expect(await screen.findByRole('heading', { level: 1, name: 'AGM 2027' })).toBeInTheDocument();
    expect(screen.getByText('Rasimu')).toBeInTheDocument();
    expect(document.querySelector('.vk-page-header__meta')).toHaveTextContent(
      '3 Nov 2026, saa 08:00 – 16:00 · Chama cha Walimu',
    );
    const buttons = screen.getAllByRole('button').map((b) => b.textContent);
    expect(buttons).toEqual(['Hakiki', 'Chapisha']); // primary last
  });

  it('has no meta line or actions when there are none', async () => {
    renderWithProviders(<PageHeader title="Dashibodi" />);
    await screen.findByRole('heading', { level: 1 });
    expect(document.querySelector('.vk-page-header__meta')).toBeNull();
    expect(document.querySelector('.vk-page-header__actions')).toBeNull();
  });

  it('shows "← Back" on narrow screens, where breadcrumbs are hidden', async () => {
    stubWidth(false);
    renderWithProviders(
      <PageHeader title="Mwenyekiti" back={{ to: '/events/1', label: 'Rudi' }} />,
    );
    const link = await screen.findByRole('link', { name: /Rudi/ });
    expect(link).toHaveAttribute('href', '/events/1');
  });

  it('hides "← Back" on wide screens', async () => {
    stubWidth(true);
    renderWithProviders(
      <PageHeader title="Mwenyekiti" back={{ to: '/events/1', label: 'Rudi' }} />,
    );
    await screen.findByRole('heading', { level: 1 });
    expect(screen.queryByRole('link', { name: /Rudi/ })).toBeNull();
  });
});
