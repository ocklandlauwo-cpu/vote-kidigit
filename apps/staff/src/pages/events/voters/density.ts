// Voters table density (Design System 8.7): comfortable by default, compact on request. The
// choice is a per-browser convenience; storage may be unavailable (private mode).
export type Density = 'comfortable' | 'compact';

const KEY = 'vk.votersDensity';

export function readDensity(): Density {
  try {
    return globalThis.localStorage.getItem(KEY) === 'compact' ? 'compact' : 'comfortable';
  } catch {
    return 'comfortable';
  }
}

export function saveDensity(density: Density): void {
  try {
    globalThis.localStorage.setItem(KEY, density);
  } catch {
    // The choice lasts for this visit only.
  }
}
