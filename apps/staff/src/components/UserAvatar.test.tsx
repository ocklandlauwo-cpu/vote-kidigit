import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderWithProviders } from '../test/render';
import { avatarTone, initials } from './avatar';
import { UserAvatar } from './UserAvatar';

describe('UserAvatar', () => {
  it('uses the first letters of the first two names', () => {
    expect(initials('neema juma mushi')).toBe('NJ');
    expect(initials('  Asha ')).toBe('A');
  });

  it('picks a stable tone from the user ID', () => {
    const id = '0190f0a1-2b3c-7d4e-8f90-123456789abc';
    expect(avatarTone(id)).toBe(avatarTone(id));
    const tones = new Set(Array.from({ length: 50 }, (_, i) => avatarTone(`user-${i}`)));
    expect(tones.size).toBe(6);
  });

  it.each([24, 32, 40, 64] as const)('renders at %i px with the tone', async (size) => {
    renderWithProviders(<UserAvatar userId="u-1" name="Neema Mushi" size={size} />);
    const avatar = (await screen.findByText('NM')).closest('.ant-avatar');
    expect(avatar).toHaveAttribute('data-tone', avatarTone('u-1'));
  });
});
