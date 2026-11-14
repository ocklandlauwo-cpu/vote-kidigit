import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderWithProviders } from '../test/render';
import { SmallGroupTag } from './SmallGroupTag';

describe('SmallGroupTag (PRD NFR-22)', () => {
  it.each([1, 4])('warns for %i voters', (voted) => {
    renderWithProviders(<SmallGroupTag voted={voted} />);
    expect(screen.getByText('Wapiga kura chini ya 5')).toHaveAccessibleDescription(
      /nani alimchagua nani/,
    );
  });

  it.each([0, 5, 120])('stays silent for %i voters', (voted) => {
    renderWithProviders(<SmallGroupTag voted={voted} />);
    expect(screen.queryByText('Wapiga kura chini ya 5')).toBeNull();
  });
});
