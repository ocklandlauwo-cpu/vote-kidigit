// Organization colour → readable brand tokens (Design System 3.4). Used by the voter app at
// runtime (12.5) and by the settings preview (SYS-03). Pure functions, no DOM.
import { neutral } from './tokens.js';

export const MIN_CONTRAST = 4.5;
const LIGHTNESS_STEP = 2;
const HOVER_SHIFT = 6;
const SUBTLE_ALPHA = { light: 0.1, dark: 0.18 } as const;
const LIGHT_SURFACE = neutral[0];
const DARK_SURFACE = neutral[900];
const DARK_ON_BRAND = neutral[950];

export interface BrandTokens {
  brand: string;
  brandHover: string;
  onBrand: string;
  brandSubtle: string;
}

export interface DerivedBrand {
  /** The colour as entered, normalized to #RRGGBB. */
  original: string;
  light: BrandTokens;
  dark: BrandTokens;
  /** True when either theme's brand differs from the original ("Adjusted for readability"). */
  adjusted: boolean;
}

interface Rgb {
  r: number;
  g: number;
  b: number;
}
interface Hsl {
  h: number;
  s: number;
  l: number;
}

const HEX_PATTERN = /^#?([0-9a-f]{6})$/i;

export function isHexColor(value: string): boolean {
  return HEX_PATTERN.test(value.trim());
}

function parseHex(hex: string): Rgb {
  const match = HEX_PATTERN.exec(hex.trim());
  if (!match?.[1]) throw new Error(`Not a #RRGGBB colour: ${hex}`);
  const n = parseInt(match[1], 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function toHex({ r, g, b }: Rgb): string {
  const part = (v: number) =>
    Math.round(Math.min(255, Math.max(0, v)))
      .toString(16)
      .padStart(2, '0');
  return `#${part(r)}${part(g)}${part(b)}`.toUpperCase();
}

function rgbToHsl({ r, g, b }: Rgb): Hsl {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l: l * 100 };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === rn) h = (gn - bn) / d + (gn < bn ? 6 : 0);
  else if (max === gn) h = (bn - rn) / d + 2;
  else h = (rn - gn) / d + 4;
  return { h: h * 60, s: s * 100, l: l * 100 };
}

function hslToRgb({ h, s, l }: Hsl): Rgb {
  const sn = s / 100;
  const ln = l / 100;
  const c = (1 - Math.abs(2 * ln - 1)) * sn;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = ln - c / 2;
  const [r1, g1, b1] =
    h < 60
      ? [c, x, 0]
      : h < 120
        ? [x, c, 0]
        : h < 180
          ? [0, c, x]
          : h < 240
            ? [0, x, c]
            : h < 300
              ? [x, 0, c]
              : [c, 0, x];
  return { r: (r1 + m) * 255, g: (g1 + m) * 255, b: (b1 + m) * 255 };
}

function withLightness(hex: string, lightness: number): string {
  const hsl = rgbToHsl(parseHex(hex));
  return toHex(hslToRgb({ ...hsl, l: Math.min(100, Math.max(0, lightness)) }));
}

function lightnessOf(hex: string): number {
  return rgbToHsl(parseHex(hex)).l;
}

/** WCAG 2.x relative luminance. */
export function relativeLuminance(hex: string): number {
  const channel = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const { r, g, b } = parseHex(hex);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** WCAG 2.x contrast ratio between two colours (1–21). */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x) as [
    number,
    number,
  ];
  return (hi + 0.05) / (lo + 0.05);
}

/** Colour `top` at `alpha` opacity over an opaque `bottom`, flattened to #RRGGBB. */
function blend(top: string, bottom: string, alpha: number): string {
  const t = parseHex(top);
  const b = parseHex(bottom);
  return toHex({
    r: t.r * alpha + b.r * (1 - alpha),
    g: t.g * alpha + b.g * (1 - alpha),
    b: t.b * alpha + b.b * (1 - alpha),
  });
}

/**
 * Moves lightness in 2% steps (down for the light theme, up for the dark theme) until the
 * colour reaches 4.5:1 against the surface; stops at black or white.
 */
function adjustForSurface(hex: string, surface: string, direction: -1 | 1): string {
  let color = hex;
  let lightness = lightnessOf(hex);
  while (contrastRatio(color, surface) < MIN_CONTRAST) {
    const next = lightness + direction * LIGHTNESS_STEP;
    if (next < 0 || next > 100) {
      return direction < 0 ? '#000000' : '#FFFFFF';
    }
    lightness = next;
    color = withLightness(hex, lightness);
  }
  return color;
}

function tokensFor(brand: string, theme: 'light' | 'dark'): BrandTokens {
  const surface = theme === 'light' ? LIGHT_SURFACE : DARK_SURFACE;
  const hoverShift = theme === 'light' ? -HOVER_SHIFT : HOVER_SHIFT;
  return {
    brand,
    brandHover: withLightness(brand, lightnessOf(brand) + hoverShift),
    onBrand: contrastRatio(LIGHT_SURFACE, brand) >= MIN_CONTRAST ? LIGHT_SURFACE : DARK_ON_BRAND,
    brandSubtle: blend(brand, surface, SUBTLE_ALPHA[theme]),
  };
}

/** Derives the four brand tokens for both themes from an organization's primary colour. */
export function deriveBrandTokens(hex: string): DerivedBrand {
  const original = toHex(parseHex(hex));
  const light = tokensFor(adjustForSurface(original, LIGHT_SURFACE, -1), 'light');
  const dark = tokensFor(adjustForSurface(original, DARK_SURFACE, 1), 'dark');
  return {
    original,
    light,
    dark,
    adjusted: light.brand !== original || dark.brand !== original,
  };
}
