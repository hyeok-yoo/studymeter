/**
 * GlassCard — 반투명 유리 표면 (웹 .glass-card 티어의 RN 근사).
 *
 * RN 에는 backdrop-filter 가 없으므로 "블러 없는 저비용 유리"로 근사한다:
 * 반투명 배경 + 하이라이트 상단 보더 + 소프트 그림자. 웹 v5 의 원칙과 동일하게
 * 카드 위 카드에 블러를 쌓지 않는다.
 */
import type { ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';

type GlassCardProps = {
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
  /** 카드 라운드 — 기본은 xl(28). */
  radius?: number;
};

export function GlassCard({ children, style, radius }: GlassCardProps) {
  const theme = useTheme();
  const borderRadius = radius ?? theme.radius.xl;

  return (
    <View
      style={[
        styles.base,
        {
          borderRadius,
          backgroundColor: theme.colors.glassBg,
          borderColor: theme.colors.glassBorder,
          borderTopColor: theme.colors.glassHighlight,
          shadowColor: theme.colors.shadowColor,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    borderWidth: StyleSheet.hairlineWidth,
    padding: 20,
    // 웹 --glass-shadow 근사 (0 12px 32px -8px)
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.12,
    shadowRadius: 24,
    elevation: 6,
  },
});
