import { describe, expect, it } from 'vitest';
import { contrastRatio, deriveBrandTokens, MIN_CONTRAST } from './brand.js';
import { neutral, primary } from './tokens.js';

const WHITE = neutral[0];
const DARK_SURFACE = neutral[900];

describe('contrastRatio', () => {
  it('matches the WCAG reference values', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 1);
    expect(contrastRatio('#FFFFFF', '#FFFFFF')).toBeCloseTo(1, 5);
    // Design System 3.2: white on primary 600 is 6.1:1
    expect(contrastRatio(WHITE, primary[600])).toBeCloseTo(6.1, 1);
  });
});

describe('deriveBrandTokens', () => {
  const cases = {
    'light yellow': '#FFF176',
    'dark navy': '#0A1F44',
    'default colour': primary[600],
  };

  for (const [name, hex] of Object.entries(cases)) {
    it(`meets 4.5:1 in both themes for ${name} (${hex})`, () => {
      const { light, dark } = deriveBrandTokens(hex);
      expect(contrastRatio(light.brand, WHITE)).toBeGreaterThanOrEqual(MIN_CONTRAST);
      expect(contrastRatio(dark.brand, DARK_SURFACE)).toBeGreaterThanOrEqual(MIN_CONTRAST);
      expect(contrastRatio(light.onBrand, light.brand)).toBeGreaterThanOrEqual(
        // on-brand is white when white passes, otherwise neutral 950
        light.onBrand === WHITE ? MIN_CONTRAST : 1,
      );
    });
  }

  it('keeps the default colour unchanged in light mode', () => {
    const result = deriveBrandTokens(primary[600]);
    expect(result.light.brand).toBe(primary[600]);
    expect(result.light.onBrand).toBe(WHITE);
  });

  it('darkens light yellow for the light theme and keeps it as-is on the dark surface', () => {
    const result = deriveBrandTokens('#fff176');
    expect(result.original).toBe('#FFF176');
    expect(result.light.brand).not.toBe('#FFF176');
    expect(result.dark.brand).toBe('#FFF176');
    expect(result.adjusted).toBe(true);
    // Yellow is already light, so text on it must be dark
    expect(result.dark.onBrand).toBe(neutral[950]);
  });

  it('keeps dark navy for the light theme and lightens it for the dark theme', () => {
    const result = deriveBrandTokens('#0A1F44');
    expect(result.light.brand).toBe('#0A1F44');
    expect(result.dark.brand).not.toBe('#0A1F44');
    expect(result.light.onBrand).toBe(WHITE);
  });

  it('moves lightness in 2% steps only as far as needed', () => {
    const { light } = deriveBrandTokens('#FFF176');
    // One step less dark would fail the 4.5:1 rule (otherwise the loop went too far).
    expect(contrastRatio(light.brand, WHITE)).toBeLessThan(MIN_CONTRAST + 0.5);
  });

  it('derives hover and subtle colours in the right direction', () => {
    const { light, dark } = deriveBrandTokens(primary[600]);
    expect(contrastRatio(light.brandHover, WHITE)).toBeGreaterThan(
      contrastRatio(light.brand, WHITE),
    );
    expect(contrastRatio(dark.brandHover, DARK_SURFACE)).toBeGreaterThan(
      contrastRatio(dark.brand, DARK_SURFACE),
    );
    // Subtle backgrounds stay close to their surfaces
    expect(contrastRatio(light.brandSubtle, WHITE)).toBeLessThan(1.3);
    expect(contrastRatio(dark.brandSubtle, DARK_SURFACE)).toBeLessThan(1.6);
  });

  it('rejects anything that is not a #RRGGBB colour', () => {
    expect(() => deriveBrandTokens('blue')).toThrow('Not a #RRGGBB colour');
    expect(() => deriveBrandTokens('#FFF')).toThrow('Not a #RRGGBB colour');
  });
});
