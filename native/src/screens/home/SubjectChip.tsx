/**
 * SubjectChip — 홈 히어로 아래 "과목 · 시간" 유리 칩. 리스트에서 다수 렌더되므로 memo.
 *
 * 웹 Home.tsx 의 `glass-card-elevated` 라운드 칩을 RN 으로 옮긴다.
 * 색은 전부 useTheme() 토큰. 등장은 FadeInDown 스프링(부모가 delay 를 준다).
 */
import { memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useTheme } from '../../theme/ThemeProvider';
import { formatDurationHourMinute } from '../../data/dao';

type SubjectChipProps = {
  subject: string;
  totalMs: number;
  /** 등장 스태거용 지연(ms). */
  delay?: number;
};

function SubjectChipBase({ subject, totalMs, delay = 0 }: SubjectChipProps) {
  const theme = useTheme();
  return (
    <Animated.View entering={FadeInDown.springify().delay(delay)}>
      <View
        style={[
          styles.chip,
          {
            backgroundColor: theme.colors.chipBg,
            borderColor: theme.colors.glassBorder,
            borderTopColor: theme.colors.glassHighlight,
          },
        ]}
      >
        <View style={[styles.dot, { backgroundColor: theme.colors.primary }]} />
        <Text style={[styles.label, { color: theme.colors.text }]}>{subject}</Text>
        <Text style={[styles.time, { color: theme.colors.textSecondary }]}>
          {formatDurationHourMinute(totalMs)}
        </Text>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  dot: { width: 7, height: 7, borderRadius: 999 },
  label: { fontSize: 13, fontWeight: '700' },
  time: { fontSize: 13, fontWeight: '600' },
});

export const SubjectChip = memo(SubjectChipBase);
