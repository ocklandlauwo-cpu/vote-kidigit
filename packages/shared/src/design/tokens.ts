// The token values of tokens.css as a typed object (Design System 12). Used where CSS
// variables cannot be: the Ant Design theme (12.2), brand colour maths (3.4), PDF templates,
// and the component gallery's token listings. Keep in step with tokens.css.

export const primary = {
  50: '#EEF7FA',
  100: '#D5ECF3',
  200: '#A9D7E6',
  300: '#72BBD3',
  400: '#3D9CBD',
  500: '#1A80A3',
  600: '#0B6A8A',
  700: '#09566F',
  800: '#0A4559',
  900: '#0B3646',
  950: '#072330',
} as const;

export const neutral = {
  0: '#FFFFFF',
  50: '#F4F6F8',
  100: '#E9EDF1',
  200: '#D6DDE3',
  300: '#B8C3CC',
  400: '#7F8C98',
  500: '#5E6B77',
  600: '#4C5864',
  700: '#36414B',
  800: '#232C35',
  900: '#161D24',
  950: '#0D1217',
} as const;

const statusScale = (
  s50: string,
  s200: string,
  s400: string,
  s600: string,
  s700: string,
  s800: string,
  s950: string,
) => ({ 50: s50, 200: s200, 400: s400, 600: s600, 700: s700, 800: s800, 950: s950 }) as const;

export const success = statusScale(
  '#F0FDF4',
  '#BBF7D0',
  '#4ADE80',
  '#15803D',
  '#166534',
  '#14532D',
  '#052E16',
);
export const warning = statusScale(
  '#FFFBEB',
  '#FDE68A',
  '#FBBF24',
  '#B45309',
  '#92400E',
  '#78350F',
  '#451A03',
);
export const danger = statusScale(
  '#FEF2F2',
  '#FECACA',
  '#F87171',
  '#DC2626',
  '#B91C1C',
  '#991B1B',
  '#450A0A',
);
export const violet = statusScale(
  '#F5F3FF',
  '#DDD6FE',
  '#A78BFA',
  '#7C3AED',
  '#6D28D9',
  '#5B21B6',
  '#2E1065',
);

export const palettes = { primary, neutral, success, warning, danger, violet } as const;
export type PaletteName = keyof typeof palettes;

/** Translucent values that are not palette steps (focus rings, overlays). */
export const translucent = {
  light: {
    focusSoft: 'rgba(26,128,163,0.24)',
    dangerSoft: 'rgba(220,38,38,0.20)',
    overlay: 'rgba(13,18,23,0.48)',
  },
  dark: {
    focusSoft: 'rgba(114,187,211,0.32)',
    dangerSoft: 'rgba(248,113,113,0.32)',
    overlay: 'rgba(0,0,0,0.64)',
  },
} as const;

/** Semantic colour tokens (Design System 3.2): the only colour names components use. */
export const semanticColorTokens = [
  'bg',
  'surface',
  'surface-raised',
  'surface-muted',
  'border',
  'border-strong',
  'text',
  'text-secondary',
  'text-tertiary',
  'text-disabled',
  'text-inverse',
  'primary',
  'primary-hover',
  'primary-active',
  'on-primary',
  'primary-subtle',
  'primary-subtle-text',
  'focus',
  'focus-soft',
  'overlay',
  'skeleton',
  'tooltip-bg',
  'brand',
  'brand-hover',
  'on-brand',
  'brand-subtle',
] as const;

/** Status tones; each has fg, bg, border, solid, solid-hover and on-…-solid variables. */
export const tones = ['success', 'warning', 'danger', 'info', 'violet', 'neutral'] as const;
export type Tone = (typeof tones)[number];

export const fontFamily =
  'Inter, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
export const fontFamilyMono =
  'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace';

/** Type scale (Design System 4.2): [size, line height] in px per surface. */
export const typeScale = {
  display: { staff: null, voter: [36, 44], weight: 700 },
  h1: { staff: [24, 32], voter: [28, 36], weight: 600 },
  h2: { staff: [20, 28], voter: [24, 32], weight: 600 },
  h3: { staff: [16, 24], voter: [20, 28], weight: 600 },
  h4: { staff: [14, 22], voter: [18, 26], weight: 600 },
  'body-lg': { staff: [16, 24], voter: [18, 28], weight: 400 },
  body: { staff: [14, 22], voter: [16, 24], weight: 400 },
  'body-sm': { staff: [12, 20], voter: [14, 20], weight: 400 },
  label: { staff: [14, 22], voter: [16, 24], weight: 500 },
  caption: { staff: [12, 16], voter: [13, 18], weight: 500 },
  overline: { staff: [12, 16], voter: [12, 16], weight: 600 },
  stat: { staff: [30, 38], voter: [32, 40], weight: 600 },
  code: { staff: [14, 22], voter: [20, 28], weight: 500 },
} as const;
export type TypeToken = keyof typeof typeScale;

/** Spacing scale (Design System 5.1): token suffix → px. */
export const space = {
  '0': 0,
  '0-5': 2,
  '1': 4,
  '2': 8,
  '3': 12,
  '4': 16,
  '5': 20,
  '6': 24,
  '8': 32,
  '10': 40,
  '12': 48,
  '16': 64,
  '20': 80,
} as const;

export const radius = { xs: 4, sm: 6, md: 8, lg: 12, xl: 16, full: 9999 } as const;

/** 5:7 photo previews (Design System 7.6, 8.6): [width, height] in px. */
export const photoSize = {
  field: [70, 98],
  category: [40, 56],
  contester: [48, 67],
  row: [32, 45],
} as const;

export const shadow = {
  light: {
    sm: '0 1px 2px rgba(13,18,23,0.06), 0 4px 12px rgba(13,18,23,0.08)',
    md: '0 4px 8px rgba(13,18,23,0.06), 0 12px 32px rgba(13,18,23,0.16)',
  },
  dark: {
    sm: '0 1px 2px rgba(0,0,0,0.4), 0 4px 12px rgba(0,0,0,0.4)',
    md: '0 4px 8px rgba(0,0,0,0.5), 0 12px 32px rgba(0,0,0,0.6)',
  },
} as const;

export const zIndex = {
  base: 0,
  sticky: 100,
  sidebar: 200,
  dropdown: 1000,
  overlay: 1100,
  modal: 1110,
  toast: 1200,
  tooltip: 1300,
} as const;

export const duration = { fast: 120, base: 200, slow: 300 } as const;
export const easing = {
  standard: 'cubic-bezier(0.2,0,0,1)',
  exit: 'cubic-bezier(0.4,0,1,1)',
} as const;

/** Breakpoints (Design System 5.2): name → min width in px. */
export const breakpoints = { xs: 0, sm: 480, md: 768, lg: 1024, xl: 1280, '2xl': 1440 } as const;
