/**
 * DiaryRow — 일기 목록의 한 줄 (점수 · 한마디 · 태그). 리스트용이라 memo.
 *
 * 웹 Records.tsx DiaryTab 의 항목을 옮긴다. 색은 전부 useTheme() 토큰,
 * 등장은 FadeInDown 스프링(부모가 delay). 편집 진입은 다음 단계라 표시 전용.
 */
import { memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { GlassCard } from '../../components';
import { useTheme } from '../../theme/ThemeProvider';
import type { DiaryEntry } from '../../data/schema';

type DiaryRowProps = {
  entry: DiaryEntry;
  delay?: number;
};

function DiaryRowBase({ entry, delay = 0 }: DiaryRowProps) {
  const theme = useTheme();
  return (
    <Animated.View entering={FadeInDown.springify().delay(delay)}>
      <GlassCard style={styles.card} radius={theme.radius.lg}>
        <View style={styles.row}>
          <View style={styles.scoreBox}>
            <Text style={[styles.score, { color: theme.colors.primary }]}>{entry.score}</Text>
            <Text style={[styles.scoreOutOf, { color: theme.colors.textSecondary }]}>/10</Text>
          </View>
          <View style={styles.body}>
            <View style={styles.dateLine}>
              <Text style={[styles.date, { color: theme.colors.textSecondary }]}>{entry.date}</Text>
              {entry.auto ? (
                <View style={[styles.autoChip, { backgroundColor: theme.colors.chipBg }]}>
                  <Text style={[styles.autoText, { color: theme.colors.textSecondary }]}>자동</Text>
                </View>
              ) : null}
            </View>
            {entry.oneLiner ? (
              <Text style={[styles.oneLiner, { color: theme.colors.text }]} numberOfLines={2}>
                “{entry.oneLiner}”
              </Text>
            ) : null}
            {entry.dayTags.length > 0 ? (
              <View style={styles.tagRow}>
                {entry.dayTags.slice(0, 4).map((t) => (
                  <View key={t} style={[styles.tag, { backgroundColor: theme.colors.chipBg }]}>
                    <Text style={[styles.tagText, { color: theme.colors.textSecondary }]}>{t}</Text>
                  </View>
                ))}
              </View>
            ) : null}
          </View>
        </View>
      </GlassCard>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: { padding: 14 },
  row: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  scoreBox: { width: 44, alignItems: 'center' },
  score: { fontSize: 22, fontWeight: '800', fontVariant: ['tabular-nums'] },
  scoreOutOf: { fontSize: 10, fontWeight: '700' },
  body: { flex: 1, gap: 5 },
  dateLine: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  date: { fontSize: 12, fontWeight: '700' },
  autoChip: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999 },
  autoText: { fontSize: 10, fontWeight: '700' },
  oneLiner: { fontSize: 14, fontWeight: '600', lineHeight: 20 },
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 5, marginTop: 2 },
  tag: { paddingHorizontal: 9, paddingVertical: 3, borderRadius: 999 },
  tagText: { fontSize: 11, fontWeight: '700' },
});

export const DiaryRow = memo(DiaryRowBase);
