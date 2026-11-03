// Light / dark theme preference (Design System 12.4), framework-free so the shared package
// keeps zod as its only dependency. Each app wraps it in a hook with useSyncExternalStore:
//   useSyncExternalStore(subscribeTheme, getEffectiveTheme, () => 'light')
// Browser features are reached through globalThis with the minimal interfaces below, so this
// file also compiles in the API (no DOM types) and does nothing there. Every storage access is
// wrapped in try/catch: private windows and blocked storage throw.

export type ThemePreference = 'system' | 'light' | 'dark';
export type EffectiveTheme = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'vk-theme';
const DARK_QUERY = '(prefers-color-scheme: dark)';

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}
interface MediaQueryLike {
  matches: boolean;
  addEventListener(type: 'change', listener: () => void): void;
  removeEventListener(type: 'change', listener: () => void): void;
}
interface StorageEventLike {
  key: string | null;
}
interface BrowserGlobals {
  localStorage?: StorageLike;
  matchMedia?: (query: string) => MediaQueryLike;
  document?: { documentElement: { dataset: Record<string, string | undefined> } };
  addEventListener?: (type: 'storage', listener: (event: StorageEventLike) => void) => void;
  removeEventListener?: (type: 'storage', listener: (event: StorageEventLike) => void) => void;
}

const browser = globalThis as unknown as BrowserGlobals;
const listeners = new Set<() => void>();

function isPreference(value: unknown): value is ThemePreference {
  return value === 'system' || value === 'light' || value === 'dark';
}

function darkQuery(): MediaQueryLike | undefined {
  return typeof browser.matchMedia === 'function' ? browser.matchMedia(DARK_QUERY) : undefined;
}

/** Stored preference; 'system' when nothing (valid) is stored or storage is unavailable. */
export function readThemePreference(): ThemePreference {
  try {
    const stored = browser.localStorage?.getItem(THEME_STORAGE_KEY);
    return isPreference(stored) ? stored : 'system';
  } catch {
    return 'system';
  }
}

/** Sets data-theme on <html>: light or dark when explicit, removed for 'system'. */
export function applyThemePreference(preference: ThemePreference): void {
  const root = browser.document?.documentElement;
  if (!root) return;
  if (preference === 'system') delete root.dataset.theme;
  else root.dataset.theme = preference;
}

/** The theme in effect: the explicit preference, else the device setting. */
export function getEffectiveTheme(): EffectiveTheme {
  const preference = readThemePreference();
  if (preference !== 'system') return preference;
  return darkQuery()?.matches ? 'dark' : 'light';
}

/** Stores and applies a preference, then notifies subscribers. */
export function setThemePreference(preference: ThemePreference): void {
  try {
    if (preference === 'system') browser.localStorage?.removeItem(THEME_STORAGE_KEY);
    else browser.localStorage?.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    // Storage blocked: the choice still applies to this page view.
  }
  applyThemePreference(preference);
  for (const listener of listeners) listener();
}

/** Theme toggle: switches to the opposite of the theme currently in effect (explicit). */
export function toggleTheme(): EffectiveTheme {
  const next: EffectiveTheme = getEffectiveTheme() === 'dark' ? 'light' : 'dark';
  setThemePreference(next);
  return next;
}

/**
 * Calls `listener` when the effective theme may have changed: an in-app choice, the device
 * setting, or another tab changing the stored preference. Returns an unsubscribe function.
 */
export function subscribeTheme(listener: () => void): () => void {
  listeners.add(listener);
  const query = darkQuery();
  query?.addEventListener('change', listener);
  const onStorage = (event: StorageEventLike) => {
    if (event.key !== THEME_STORAGE_KEY) return;
    applyThemePreference(readThemePreference());
    listener();
  };
  browser.addEventListener?.('storage', onStorage);
  return () => {
    listeners.delete(listener);
    query?.removeEventListener('change', listener);
    browser.removeEventListener?.('storage', onStorage);
  };
}

/**
 * The pre-paint script for index.html (Design System 12.4): sets data-theme before the first
 * paint so an explicit dark choice never flashes light. Kept here so both apps use the same text.
 */
export const THEME_PREPAINT_SCRIPT = `(function(){try{var t=localStorage.getItem('${THEME_STORAGE_KEY}');if(t==='light'||t==='dark')document.documentElement.dataset.theme=t;}catch(e){}})();`;
