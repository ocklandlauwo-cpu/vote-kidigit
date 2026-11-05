import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// jsdom has no ResizeObserver. Ant Design observes sizes in effects (tooltips, overflow), which
// throws when such an effect runs before the test ends, depending on timing. Sizes are always
// 0 in jsdom, so an observer that never reports is accurate.
class NoopResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
globalThis.ResizeObserver ??= NoopResizeObserver;

afterEach(() => {
  cleanup();
});
