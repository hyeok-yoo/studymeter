/**
 * SectionLabel — iOS 설정 스타일의 작은 uppercase 섹션 라벨. 웹 SectionLabel 미러.
 */
import { StyleSheet, Text } from 'react-native';
import { useTheme } from '../../theme/ThemeProvider';

export function SectionLabel({ children }: { children: string }) {
  const theme = useTheme();
  return <Text style={[styles.label, { color: theme.colors.textSecondary }]}>{children}</Text>;
}

const styles = StyleSheet.create({
  label: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: 8,
    marginLeft: 4,
    opacity: 0.75,
  },
});
