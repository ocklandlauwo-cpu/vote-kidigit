import { screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { i18n } from '../i18n';
import { renderWithProviders } from '../test/render';
import { StatusBadge } from './StatusBadge';
import { STATUS_SPECS, type StatusDomain } from './statusSpecs';

// Design System 3.3, as the badge must show it.
const EXPECTED: [StatusDomain, string, string, string, string][] = [
  ['event', 'draft', 'neutral', 'Rasimu', 'Draft'],
  ['event', 'scheduled', 'info', 'Imepangwa', 'Scheduled'],
  ['event', 'open', 'success', 'Wazi', 'Open'],
  ['event', 'closed', 'warning', 'Imefungwa', 'Closed'],
  ['event', 'results_published', 'violet', 'Matokeo yametangazwa', 'Results published'],
  ['event', 'cancelled', 'danger', 'Imesitishwa', 'Cancelled'],
  ['event', 'archived', 'neutral', 'Kumbukumbu', 'Archived'],
  ['category', 'not_open', 'neutral', 'Itafunguliwa', 'Opens later'],
  ['category', 'open', 'success', 'Wazi', 'Open'],
  ['category', 'closed', 'warning', 'Imefungwa', 'Closed'],
  ['category', 'inactive', 'neutral', 'Haitumiki', 'Inactive'],
  ['code', 'not_sent', 'neutral', 'Haijatumwa', 'Not sent'],
  ['code', 'sent', 'info', 'Imetumwa', 'Sent'],
  ['code', 'delivered', 'success', 'Imefika', 'Delivered'],
  ['code', 'failed', 'danger', 'Imeshindikana', 'Failed'],
  ['voter', 'voted', 'success', 'Amepiga kura', 'Voted'],
  ['voter', 'not_voted', 'neutral', 'Bado', 'Not yet'],
  ['result', 'winner', 'success', 'Mshindi', 'Winner'],
  ['result', 'tie', 'warning', 'Sare', 'Tie'],
  ['user', 'invited', 'info', 'Amealikwa', 'Invited'],
  ['user', 'active', 'success', 'Hai', 'Active'],
  ['user', 'deactivated', 'neutral', 'Amezimwa', 'Deactivated'],
];

describe('StatusBadge', () => {
  afterEach(async () => {
    await i18n.changeLanguage('sw');
  });

  it('covers every row of Design System 3.3', () => {
    const specs = Object.entries(STATUS_SPECS).flatMap(([domain, values]) =>
      Object.keys(values).map((value) => `${domain}.${value}`),
    );
    expect(specs.sort()).toEqual(EXPECTED.map(([d, v]) => `${d}.${v}`).sort());
  });

  it.each(EXPECTED)('%s %s: tone %s, icon and label', async (domain, value, tone, sw, en) => {
    const { container, unmount } = renderWithProviders(
      <StatusBadge domain={domain} value={value as never} />,
    );
    const badge = await screen.findByText(sw);
    const root = badge.closest('.vk-status-badge');
    expect(root).toHaveAttribute('data-tone', tone);
    expect(root).toHaveClass(`vk-tone-${tone}`);
    // Colour + icon + text, never colour alone (3.3); the Open event shows the live dot.
    if (domain === 'event' && value === 'open') {
      expect(container.querySelector('.vk-live-dot')).not.toBeNull();
      expect(container.querySelector('.anticon')).toBeNull();
    } else {
      expect(container.querySelector('.anticon')).not.toBeNull();
    }
    unmount();
    await i18n.changeLanguage('en');
    renderWithProviders(<StatusBadge domain={domain} value={value as never} />);
    expect(await screen.findByText(en)).toBeInTheDocument();
  });
});
