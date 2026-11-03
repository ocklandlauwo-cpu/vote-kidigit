// @vitest-environment jsdom
/// <reference lib="dom" />
// DOM types for this jsdom test only; theme.ts itself compiles without them (the API builds it).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getEffectiveTheme,
  readThemePreference,
  setThemePreference,
  subscribeTheme,
  THEME_STORAGE_KEY,
  toggleTheme,
} from './theme.js';

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

describe('theme preference', () => {
  beforeEach(() => {
    localStorage.clear();
    delete document.documentElement.dataset.theme;
    mockDeviceDark(false);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('follows the device by default', () => {
    expect(readThemePreference()).toBe('system');
    expect(getEffectiveTheme()).toBe('light');
    mockDeviceDark(true);
    expect(getEffectiveTheme()).toBe('dark');
  });

  it('stores an explicit choice and sets data-theme on <html>', () => {
    setThemePreference('dark');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(getEffectiveTheme()).toBe('dark');
  });

  it("removes the stored value and data-theme for 'system'", () => {
    setThemePreference('light');
    setThemePreference('system');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
    expect(document.documentElement.dataset.theme).toBeUndefined();
  });

  it('toggles to the opposite of the effective theme', () => {
    mockDeviceDark(true);
    expect(toggleTheme()).toBe('light');
    expect(toggleTheme()).toBe('dark');
  });

  it('ignores invalid stored values and blocked storage', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'purple');
    expect(readThemePreference()).toBe('system');

    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    expect(readThemePreference()).toBe('system');
    expect(() => setThemePreference('dark')).not.toThrow();
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('notifies subscribers until they unsubscribe', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeTheme(listener);
    setThemePreference('dark');
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    setThemePreference('light');
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
