/**
 * ScreenShell — 탭 셸 화면 공통 골격. 토큰 적용 배경 + 안전영역 + 타이틀.
 * 1단계에서는 각 탭이 이 셸에 화면 이름만 얹은 자리표시자다.
 */
import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '../theme/ThemeProvider';

type ScreenShellProps = {
  title: string;
  subtitle?: string;
  children?: ReactNode;
};

export function ScreenShell({ title, subtitle, children }: ScreenShellProps) {
  const theme = useTheme();

  return (
    <SafeAreaView
      edges={['top', 'left', 'right']}
      style={[styles.root, { backgroundColor: theme.colors.bg }]}
    >
      <View style={styles.content}>
        <Text style={[styles.title, { color: theme.colors.text }]}>{title}</Text>
        {subtitle ? (
          <Text style={[styles.subtitle, { color: theme.colors.textSecondary }]}>{subtitle}</Text>
        ) : null}
        {children}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { flex: 1, paddingHorizontal: 20, paddingTop: 12, gap: 16 },
  title: { fontSize: 30, fontWeight: '800', letterSpacing: -0.5 },
  subtitle: { fontSize: 15 },
});
