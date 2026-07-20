/**
 * tokens.ts — StudyMeter Liquid Glass Design System v5.0 (React Native 포팅).
 *
 * 웹의 src/index.css `:root` / `.dark` 변수들을 그대로 미러링한다.
 * RN 에는 CSS 변수가 없으므로 라이트/다크 두 팔레트를 객체로 노출하고,
 * ThemeProvider 가 useColorScheme 으로 하나를 고른다.
 *
 * 주의: RN 에는 backdrop-filter(진짜 블러)가 없다. 유리 표면은 반투명 배경 +
 * 하이라이트 보더로 근사한다(웹의 .glass-card 티어와 동일 — 블러 없는 저비용 표면).
 */

/** 브랜드 색 — 라이트/다크 공통 */
export const brand = {
  primary: '#6366f1',
  secondary: '#a855f7',
  accent: '#06b6d4',
} as const;

/** 지오메트리 — 웹의 --radius-* 미러 */
export const radius = {
  xl: 28,
  lg: 20,
  md: 14,
} as const;

/** 간격 스케일 (웹 유틸리티에 대응하는 실용 값) */
export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
} as const;

/** 타이포 — 대형 숫자는 음수 자간, 타이트한 리딩 (웹 .text-display) */
export const typography = {
  displayTracking: -0.02 * 56, // letter-spacing -0.02em @ 56px 기준(포인트 단위)
  displayLineHeightRatio: 1.05,
  captionTracking: 0.01 * 13,
} as const;

export type ColorTokens = {
  // Brand
  primary: string;
  secondary: string;
  accent: string;
  // Materials (glass)
  glassBg: string;
  glassBorder: string;
  glassHighlight: string;
  chromeBg: string;
  chipBg: string;
  scrim: string;
  surfaceElevated: string;
  // Text & surface
  text: string;
  textSecondary: string;
  bg: string;
  border: string;
  // 그림자(웹 --glass-shadow 근사)
  shadowColor: string;
};

/** Light — 웹 :root */
export const lightColors: ColorTokens = {
  primary: brand.primary,
  secondary: brand.secondary,
  accent: brand.accent,

  glassBg: 'rgba(255, 255, 255, 0.62)',
  glassBorder: 'rgba(255, 255, 255, 0.45)',
  glassHighlight: 'rgba(255, 255, 255, 0.75)',
  chromeBg: 'rgba(255, 255, 255, 0.6)',
  chipBg: 'rgba(255, 255, 255, 0.55)',
  scrim: 'rgba(15, 23, 42, 0.35)',
  surfaceElevated: 'rgba(255, 255, 255, 0.85)',

  text: '#0f172a',
  textSecondary: '#475569',
  bg: '#eef2f7',
  border: 'rgba(15, 23, 42, 0.07)',

  shadowColor: '#0f172a',
};

/** Dark — 웹 .dark */
export const darkColors: ColorTokens = {
  primary: brand.primary,
  secondary: brand.secondary,
  accent: brand.accent,

  glassBg: 'rgba(17, 25, 46, 0.58)',
  glassBorder: 'rgba(255, 255, 255, 0.09)',
  glassHighlight: 'rgba(255, 255, 255, 0.14)',
  chromeBg: 'rgba(10, 15, 30, 0.62)',
  chipBg: 'rgba(255, 255, 255, 0.06)',
  scrim: 'rgba(0, 0, 0, 0.55)',
  surfaceElevated: 'rgba(30, 41, 59, 0.72)',

  text: '#f8fafc',
  textSecondary: '#94a3b8',
  bg: '#04070f',
  border: 'rgba(255, 255, 255, 0.1)',

  shadowColor: '#000000',
};

export type Theme = {
  colors: ColorTokens;
  radius: typeof radius;
  spacing: typeof spacing;
  typography: typeof typography;
  dark: boolean;
};

export const lightTheme: Theme = {
  colors: lightColors,
  radius,
  spacing,
  typography,
  dark: false,
};

export const darkTheme: Theme = {
  colors: darkColors,
  radius,
  spacing,
  typography,
  dark: true,
};
