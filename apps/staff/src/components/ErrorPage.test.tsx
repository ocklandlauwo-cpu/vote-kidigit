import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { i18n } from '../i18n';
import { renderWithProviders } from '../test/render';
import { ErrorPage, type ErrorPageKind } from './ErrorPage';

const PAGES: [ErrorPageKind, string, string, string, string][] = [
  ['offline', 'ERR-01', 'disconnect', 'Hakuna mtandao', 'No internet connection'],
  [
    'notFound',
    'ERR-03',
    'file-search',
    'Hatukuweza kupata ukurasa huo',
    'We couldn’t find that page',
  ],
  ['expired', 'ERR-04', 'clock-circle', 'Kiungo hiki kimeisha muda', 'This link has expired'],
  [
    'server',
    'ERR-05',
    'close-circle',
    'Kuna hitilafu upande wetu',
    'Something went wrong on our side',
  ],
];

describe('ErrorPage', () => {
  afterEach(async () => {
    await i18n.changeLanguage('sw');
  });

  it.each(PAGES)('%s is %s with the %s icon, in both languages', async (kind, id, icon, sw, en) => {
    const { container, unmount } = renderWithProviders(<ErrorPage kind={kind} />);
    expect(await screen.findByRole('heading', { level: 1, name: sw })).toBeInTheDocument();
    expect(container.querySelector(`[data-error-page="${id}"]`)).not.toBeNull();
    expect(container.querySelector(`[aria-label="${icon}"]`)).not.toBeNull();
    unmount();
    await i18n.changeLanguage('en');
    renderWithProviders(<ErrorPage kind={kind} />);
    expect(await screen.findByRole('heading', { level: 1, name: en })).toBeInTheDocument();
  });

  it.each(['offline', 'server'] as const)('%s offers Retry', async (kind) => {
    const onRetry = vi.fn();
    renderWithProviders(<ErrorPage kind={kind} onRetry={onRetry} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Jaribu tena' }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it.each(['notFound', 'expired'] as const)('%s never offers Retry', async (kind) => {
    renderWithProviders(<ErrorPage kind={kind} onRetry={vi.fn()} />);
    await screen.findByRole('heading', { level: 1 });
    expect(screen.queryByRole('button', { name: 'Jaribu tena' })).toBeNull();
  });

  it('not found offers the way back', async () => {
    const onClick = vi.fn();
    renderWithProviders(
      <ErrorPage kind="notFound" action={{ label: 'Rudi kwenye dashibodi', onClick }} />,
    );
    const button = await screen.findByRole('button', { name: 'Rudi kwenye dashibodi' });
    expect(button).toHaveClass('ant-btn-primary');
    await userEvent.click(button);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('server error names the support phone when known and is announced', async () => {
    renderWithProviders(<ErrorPage kind="server" supportPhone="+255 700 000 001" />);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Jaribu tena, au wasiliana na msaada kupitia +255 700 000 001.',
    );
  });

  it('expired link takes a context-specific title, description and action', async () => {
    renderWithProviders(
      <ErrorPage
        kind="expired"
        title="Kiungo kimeisha muda"
        description="Viungo hufanya kazi kwa dakika 60."
        action={{ label: 'Omba kiungo kipya', onClick: vi.fn() }}
      />,
    );
    expect(
      await screen.findByRole('heading', { name: 'Kiungo kimeisha muda' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Viungo hufanya kazi kwa dakika 60.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Omba kiungo kipya' })).toBeInTheDocument();
  });
});
