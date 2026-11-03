import { THEME_STORAGE_KEY } from '@vote-kidigit/shared';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ThemeToggle } from './ThemeToggle';

function mockDeviceDark(dark: boolean): void {
  vi.stubGlobal(
    'matchMedia',
    vi.fn().mockImplementation((query: string) => ({
      matches: dark,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
}

describe('ThemeToggle', () => {
  beforeEach(() => {
    localStorage.clear();
    delete document.documentElement.dataset.theme;
    mockDeviceDark(false);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('shows the moon in light mode and switches to an explicit dark theme', async () => {
    render(<ThemeToggle />);
    const button = screen.getByRole('button', { name: 'Badili mwonekano' });
    expect(button.querySelector('[aria-label="moon"]')).not.toBeNull();

    await act(() => userEvent.click(button));

    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
    expect(button.querySelector('[aria-label="sun"]')).not.toBeNull();
  });

  it('starts from the device setting and switches to light from a dark device', async () => {
    mockDeviceDark(true);
    render(<ThemeToggle />);
    const button = screen.getByRole('button', { name: 'Badili mwonekano' });
    expect(button.querySelector('[aria-label="sun"]')).not.toBeNull();

    await act(() => userEvent.click(button));
    expect(document.documentElement.dataset.theme).toBe('light');
  });
});
