/**
 * ThemeProvider.tsx — useColorScheme 기반 다크/라이트 테마 컨텍스트.
 *
 * 웹은 `.dark` 클래스 토글로 CSS 변수를 바꿨다. RN 에는 시스템 색상 스킴
 * (useColorScheme)을 구독해 lightTheme / darkTheme 중 하나를 컨텍스트로 내린다.
 * app.json 의 userInterfaceStyle: "automatic" 과 짝을 이룬다.
 */
import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { useColorScheme } from 'react-native';
import { darkTheme, lightTheme, type Theme } from './tokens';

const ThemeContext = createContext<Theme>(lightTheme);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const scheme = useColorScheme();
  const theme = useMemo(() => (scheme === 'dark' ? darkTheme : lightTheme), [scheme]);
  return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>;
}

/** 어느 컴포넌트에서든 현재 테마 토큰을 읽는다. */
export function useTheme(): Theme {
  return useContext(ThemeContext);
}
