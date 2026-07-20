/**
 * TodayDiaryCard — 홈 하단 "오늘의 일기" 카드 골격.
 *
 * 웹 DiaryCard 의 3초 일기 진입점을 네이티브로 옮긴 자리표시자다.
 * - 오늘 일기(getDiaryEntry)가 있으면 점수 배지 + 한마디를 보여준다.
 * - 없으면 "일기 쓰기" 자리표시(편집 UI 는 다음 단계).
 * 색은 전부 useTheme() 토큰. 눌림은 PressableScale(아직 편집 UI 없으니 촉감만).
 */
import { StyleSheet, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { GlassCard, PressableScale } from '../../components';
import { useTheme } from '../../theme/ThemeProvider';
import type { DiaryEntry } from '../../data/schema';

type TodayDiaryCardProps = {
  entry?: DiaryEntry;
};

export function TodayDiaryCard({ entry }: TodayDiaryCardProps) {
  const theme = useTheme();

  const onPress = () => {
    // 편집 UI 는 다음 단계 — 지금은 촉각 피드백만.
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  return (
    <PressableScale onPress={onPress} accessibilityLabel="오늘의 일기" strength="soft">
      <GlassCard style={styles.card}>
        <View style={styles.header}>
          <Text style={[styles.title, { color: theme.colors.text }]}>오늘의 일기</Text>
          {entry ? (
            <View style={[styles.scoreBadge, { backgroundColor: theme.colors.primary }]}>
              <Text style={styles.scoreText}>{entry.score}</Text>
              <Text style={styles.scoreOutOf}>/10</Text>
            </View>
          ) : (
            <Text style={[styles.cta, { color: theme.colors.primary }]}>일기 쓰기 ›</Text>
          )}
        </View>

        {entry ? (
          <>
            {entry.oneLiner ? (
              <Text style={[styles.oneLiner, { color: theme.colors.text }]} numberOfLines={2}>
                “{entry.oneLiner}”
              </Text>
            ) : (
              <Text style={[styles.placeholder, { color: theme.colors.textSecondary }]}>
                오늘 하루를 한 줄로 남겨보세요.
              </Text>
            )}
            {entry.dayTags.length > 0 ? (
              <View style={styles.tagRow}>
                {entry.dayTags.slice(0, 4).map((t) => (
                  <View key={t} style={[styles.tag, { backgroundColor: theme.colors.chipBg }]}>
                    <Text style={[styles.tagText, { color: theme.colors.textSecondary }]}>{t}</Text>
                  </View>
                ))}
              </View>
            ) : null}
          </>
        ) : (
          <Text style={[styles.placeholder, { color: theme.colors.textSecondary }]}>
            아직 오늘 일기가 없어요. 하루를 짧게 돌아보며 점수와 한마디를 남겨보세요.
          </Text>
        )}
      </GlassCard>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  card: { gap: 12 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontSize: 17, fontWeight: '800' },
  cta: { fontSize: 14, fontWeight: '700' },
  scoreBadge: {
    flexDirection: 'row',
    alignItems: 'baseline',
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 999,
  },
  scoreText: { color: '#ffffff', fontSize: 16, fontWeight: '800' },
  scoreOutOf: { color: '#ffffff', fontSize: 11, fontWeight: '700', opacity: 0.8, marginLeft: 1 },
  oneLiner: { fontSize: 15, fontWeight: '600', lineHeight: 22 },
  placeholder: { fontSize: 14, fontWeight: '500', lineHeight: 20 },
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  tag: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  tagText: { fontSize: 11, fontWeight: '700' },
});
