import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Button } from 'antd';
import { describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '../test/render';
import { Banner, type BannerTone } from './Banner';

const TONES: [BannerTone, string, string][] = [
  ['info', 'info-circle', 'status'],
  ['success', 'check-circle', 'status'],
  ['warning', 'warning', 'status'],
  ['danger', 'close-circle', 'alert'],
  ['locked', 'lock', 'status'],
];

describe('Banner', () => {
  it.each(TONES)('%s: icon %s, role %s', async (tone, icon, role) => {
    const { container } = renderWithProviders(<Banner tone={tone} message="Ujumbe" />);
    const banner = await screen.findByRole(role);
    expect(banner).toHaveAttribute('data-tone', tone);
    expect(banner).toHaveTextContent('Ujumbe');
    expect(container.querySelector(`[aria-label="${icon}"]`)).not.toBeNull();
  });

  it('uses the neutral tone for locked banners', async () => {
    await renderWithProviders(<Banner tone="locked" message="Imefungwa" />).findByRole('status');
    expect(document.querySelector('.vk-banner')).toHaveClass('vk-tone-neutral');
  });

  it('shows a title above the message', async () => {
    renderWithProviders(
      <Banner tone="warning" title="Sare 3" message="Tatua kabla ya kutangaza." />,
    );
    expect(await screen.findByText('Sare 3')).toBeInTheDocument();
    expect(screen.getByText('Tatua kabla ya kutangaza.')).toBeInTheDocument();
  });

  it('shows an action', async () => {
    const onClick = vi.fn();
    renderWithProviders(
      <Banner
        tone="danger"
        message="SMS 312 zimeshindikana"
        action={<Button onClick={onClick}>Tuma tena</Button>}
      />,
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Tuma tena' }));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('can be dismissed only when it is an info banner', async () => {
    const onClose = vi.fn();
    const { unmount } = renderWithProviders(
      <Banner tone="info" message="Habari" onClose={onClose} />,
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Funga' }));
    expect(onClose).toHaveBeenCalledOnce();
    unmount();

    for (const tone of ['warning', 'danger', 'success', 'locked'] as const) {
      const view = renderWithProviders(<Banner tone={tone} message="Habari" onClose={onClose} />);
      await screen.findByText('Habari');
      expect(screen.queryByRole('button', { name: 'Funga' })).toBeNull();
      view.unmount();
    }
  });

  it('has no close button inline', async () => {
    renderWithProviders(<Banner tone="info" message="Ndani" onClose={vi.fn()} inline />);
    await screen.findByText('Ndani');
    expect(screen.queryByRole('button', { name: 'Funga' })).toBeNull();
  });
});
