/**
 * SettingsRow — GlassCard 안에서 쓰는 행 하나. 첫 행이 아니면 위쪽에 얇은 구분선.
 * layout 'row' = 라벨 좌측·컨트롤 우측(기본), 'stack' = 라벨/설명/컨트롤을 세로로.
 * 웹 SettingsRow 의 RN 미러.
 */
import type { ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { useTheme } from '../../theme/ThemeProvider';

type SettingsRowProps = {
  children: ReactNode;
  first?: boolean;
  layout?: 'row' | 'stack';
  style?: StyleProp<ViewStyle>;
};

export function SettingsRow({ children, first = false, layout = 'row', style }: SettingsRowProps) {
  const theme = useTheme();

  return (
    <View
      style={[
        styles.row,
        layout === 'row' ? styles.rowLayout : styles.stackLayout,
        { paddingTop: first ? 4 : 14 },
        !first && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.colors.border },
        style,
      ]}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    paddingHorizontal: 20,
    paddingBottom: 14,
  },
  rowLayout: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  stackLayout: {
    flexDirection: 'column',
    gap: 8,
  },
});
