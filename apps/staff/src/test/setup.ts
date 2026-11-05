import '@testing-library/jest-dom/vitest';
import { cleanup, configure } from '@testing-library/react';
import { afterEach } from 'vitest';
import '../i18n'; // Swahili, the default language

// findBy… and waitFor give up after 1 s by default; a busy CI runner rendering Ant Design and the
// router can take longer than that without anything being wrong.
configure({ asyncUtilTimeout: 5_000 });

// jsdom has no ResizeObserver. Ant Design observes sizes in effects (tooltips, overflow), which
// throws when such an effect runs before the test ends, depending on timing. Sizes are always
// 0 in jsdom, so an observer that never reports is accurate.
class NoopResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
globalThis.ResizeObserver ??= NoopResizeObserver;

// jsdom has no matchMedia either; Ant Design's breakpoints (Grid.useBreakpoint) need it. No
// query matches, like a narrow screen; tests that need a match stub it themselves.
globalThis.matchMedia ??= (query: string) =>
  ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  }) as MediaQueryList;

afterEach(() => {
  cleanup();
});
