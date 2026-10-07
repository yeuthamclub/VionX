// VionX design tokens, shared by the Expo app and the admin SPA.
// Values are plain numbers (dp/px) and hex colours so both React Native and CSS can use them.

export const palette = {
  indigo50: '#EEF0FF',
  indigo100: '#DCE0FF',
  indigo500: '#4F5BD5',
  indigo600: '#3F48B8',
  indigo700: '#323A94',
  teal100: '#CCF5EE',
  teal500: '#14B8A6',
  teal600: '#0E9384',
  amber100: '#FEF3C7',
  amber500: '#F59E0B',
  coral100: '#FFE1DC',
  coral500: '#F0604D',
  green100: '#DCFCE7',
  green600: '#16A34A',
  red100: '#FEE2E2',
  red600: '#DC2626',
  gray0: '#FFFFFF',
  gray50: '#F7F8FA',
  gray100: '#EEF0F3',
  gray200: '#DDE1E7',
  gray400: '#9AA3AF',
  gray600: '#5B6472',
  gray800: '#252B36',
  gray900: '#151922',
} as const;

export interface ColorScheme {
  background: string;
  surface: string;
  surfaceMuted: string;
  border: string;
  text: string;
  textMuted: string;
  primary: string;
  primaryPressed: string;
  onPrimary: string;
  /** Parent mode accent. */
  parent: string;
  /** Child mode accent (warmer, playful). */
  child: string;
  /** XP / reward highlights. */
  reward: string;
  success: string;
  successBg: string;
  danger: string;
  dangerBg: string;
  warning: string;
  warningBg: string;
}

export const colors: { light: ColorScheme; dark: ColorScheme } = {
  light: {
    background: palette.gray50,
    surface: palette.gray0,
    surfaceMuted: palette.gray100,
    border: palette.gray200,
    text: palette.gray900,
    textMuted: palette.gray600,
    primary: palette.indigo500,
    primaryPressed: palette.indigo600,
    onPrimary: palette.gray0,
    parent: palette.indigo500,
    child: palette.coral500,
    reward: palette.amber500,
    success: palette.green600,
    successBg: palette.green100,
    danger: palette.red600,
    dangerBg: palette.red100,
    warning: palette.amber500,
    warningBg: palette.amber100,
  },
  dark: {
    background: palette.gray900,
    surface: palette.gray800,
    surfaceMuted: '#2E3542',
    border: '#3A4250',
    text: '#F2F4F7',
    textMuted: palette.gray400,
    primary: '#7C86F0',
    primaryPressed: palette.indigo500,
    onPrimary: palette.gray900,
    parent: '#7C86F0',
    child: '#FF8A78',
    reward: '#FBBF24',
    success: '#4ADE80',
    successBg: '#14361F',
    danger: '#F87171',
    dangerBg: '#3B1717',
    warning: '#FBBF24',
    warningBg: '#3A2E0B',
  },
};

/** 4-pt spacing scale. */
export const spacing = {
  none: 0,
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
} as const;

export const radii = {
  sm: 6,
  md: 10,
  lg: 16,
  xl: 24,
  pill: 999,
} as const;

/** Font families must support Vietnamese diacritics. */
export const fontFamily = {
  sans: 'Be Vietnam Pro',
  sansFallback: 'System',
  mono: 'JetBrains Mono',
} as const;

export const fontWeight = {
  regular: '400',
  medium: '500',
  semibold: '600',
  bold: '700',
} as const;

export interface TextStyleToken {
  fontSize: number;
  lineHeight: number;
  fontWeight: (typeof fontWeight)[keyof typeof fontWeight];
}

export const typography = {
  display: { fontSize: 32, lineHeight: 40, fontWeight: fontWeight.bold },
  title: { fontSize: 24, lineHeight: 32, fontWeight: fontWeight.bold },
  heading: { fontSize: 20, lineHeight: 28, fontWeight: fontWeight.semibold },
  body: { fontSize: 16, lineHeight: 24, fontWeight: fontWeight.regular },
  bodyStrong: { fontSize: 16, lineHeight: 24, fontWeight: fontWeight.semibold },
  caption: { fontSize: 13, lineHeight: 18, fontWeight: fontWeight.regular },
  /** Grade 1-3 child mode: larger text and touch targets. */
  childBody: { fontSize: 20, lineHeight: 30, fontWeight: fontWeight.medium },
} as const satisfies Record<string, TextStyleToken>;

/** Minimum touch target (dp); child mode uses the larger value. */
export const touchTarget = { default: 44, child: 56 } as const;

export const tokens = {
  palette,
  colors,
  spacing,
  radii,
  fontFamily,
  fontWeight,
  typography,
  touchTarget,
};

/** Flattens a colour scheme to CSS custom properties (admin SPA). */
export function toCssVariables(scheme: ColorScheme): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(scheme)) {
    out[`--vx-${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`] = value;
  }
  for (const [key, value] of Object.entries(spacing)) out[`--vx-space-${key}`] = `${value}px`;
  for (const [key, value] of Object.entries(radii)) out[`--vx-radius-${key}`] = `${value}px`;
  return out;
}
