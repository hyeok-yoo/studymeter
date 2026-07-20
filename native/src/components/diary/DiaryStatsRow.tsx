/**
 * DiaryStatsRow — 자동 통계 4종(순공·목표%·세션수·졸음) 한 줄. 웹 DiaryStatsRow 미러.
 * DiaryEditorSheet(편집 중)와 DiaryEntryView(확정 후) 양쪽에서 재사용한다.
 */
import { StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../../theme/ThemeProvider';
import { formatDurationHourMinute } from '../../data/dao';
import type { DiaryStats } from '../../data/schema';

export function DiaryStatsRow({ stats }: { stats: DiaryStats }) {
  const theme = useTheme();
  const items = [
    { label: '순공', value: formatDurationHourMinute(stats.selfStudyMs) },
    { label: '목표', value: stats.goalPct !== null ? `${stats.goalPct}%` : '—' },
    { label: '세션', value: `${stats.sessionCount}회` },
    {
      label: '졸음',
      value: `${stats.drowsyCount}회`,
      warn: stats.drowsyCount > 0,
    },
  ];
  return (
    <View style={styles.row}>
      {items.map((it) => (
        <View key={it.label} style={[styles.cell, { backgroundColor: theme.colors.chipBg }]}>
          <Text
            style={[
              styles.value,
              { color: it.warn ? '#f59e0b' : theme.colors.primary },
            ]}
          >
            {it.value}
          </Text>
          <Text style={[styles.label, { color: theme.colors.textSecondary }]}>{it.label}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 8 },
  cell: { flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: 14, gap: 2 },
  value: { fontSize: 14, fontWeight: '800', fontVariant: ['tabular-nums'] },
  label: { fontSize: 10, fontWeight: '700' },
});
