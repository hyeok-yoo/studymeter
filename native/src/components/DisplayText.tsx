/**
 * DisplayText — 대형 숫자/타이틀 전용 텍스트 (웹 .text-display).
 *
 * 크기가 커질수록 자간은 음수로, 리딩은 타이트하게. 웹은 letter-spacing -0.02em,
 * line-height 1.05. RN 은 em 이 없으므로 fontSize 에 비례해 계산한다.
 */
import type { ReactNode } from 'react';
import { StyleSheet, Text, type StyleProp, type TextStyle } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';

type DisplayTextProps = {
  children?: ReactNode;
  /** 폰트 크기(pt). 기본 56 — "오늘의 집중 시간" 같은 히어로 숫자용. */
  size?: number;
  color?: string;
  weight?: TextStyle['fontWeight'];
  style?: StyleProp<TextStyle>;
  numberOfLines?: number;
};

export function DisplayText({
  children,
  size = 56,
  color,
  weight = '800',
  style,
  numberOfLines,
}: DisplayTextProps) {
  const theme = useTheme();

  return (
    <Text
      numberOfLines={numberOfLines}
      style={[
        styles.base,
        {
          fontSize: size,
          lineHeight: size * theme.typography.displayLineHeightRatio,
          letterSpacing: size * -0.02, // 웹 -0.02em
          color: color ?? theme.colors.text,
          fontWeight: weight,
        },
        style,
      ]}
    >
      {children}
    </Text>
  );
}

const styles = StyleSheet.create({
  base: {
    fontVariant: ['tabular-nums'], // 숫자 폭 고정 — 타이머가 흔들리지 않게
  },
});
