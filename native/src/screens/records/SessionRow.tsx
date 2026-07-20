/**
 * SessionRow — 하루 세션 리스트의 한 줄 (과목 · 시간 · 평가점수 chip). 리스트용이라 memo.
 *
 * 웹 Records.tsx "최근 기록" 카드의 한 항목을 옮긴다:
 * 과목/세부항목/타입 + 지속시간, 그리고 평가가 있으면 점수·태그 chip.
 * 색은 전부 useTheme() 토큰, 등장은 FadeInDown 스프링(부모가 delay).
 */
import { memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useTheme } from '../../theme/ThemeProvider';
import { formatDurationHourMinute, formatTimeHHMM } from '../../data/dao';
import { getEvalScore, type StudySession } from '../../data/schema';

type SessionRowProps = {
  session: StudySession;
  delay?: number;
};

function SessionRowBase({ session, delay = 0 }: SessionRowProps) {
  const theme = useTheme();
  const score = getEvalScore(session.evaluation);
  const tags = session.evaluation?.tags ?? [];

  return (
    <Animated.View entering={FadeInDown.springify().delay(delay)}>
      <View
        style={[
          styles.row,
          {
            backgroundColor: theme.colors.surfaceElevated,
            borderColor: theme.colors.glassBorder,
            borderTopColor: theme.colors.glassHighlight,
          },
        ]}
      >
        <View style={styles.topLine}>
          <View style={styles.left}>
            <Text style={[styles.time, { color: theme.colors.textSecondary }]}>
              {formatTimeHHMM(session.startTime)}
            </Text>
            <Text style={[styles.subject, { color: theme.colors.text }]} numberOfLines={1}>
              {session.subject}
            </Text>
            {session.subItem ? (
              <Text style={[styles.subItem, { color: theme.colors.primary }]} numberOfLines={1}>
                › {session.subItem}
              </Text>
            ) : null}
          </View>
          <Text style={[styles.duration, { color: theme.colors.text }]}>
            {formatDurationHourMinute(session.duration)}
          </Text>
        </View>

        <View style={styles.metaLine}>
          <View style={[styles.typeChip, { backgroundColor: theme.colors.chipBg }]}>
            <Text style={[styles.typeText, { color: theme.colors.textSecondary }]}>
              {session.type}
            </Text>
          </View>
          {score !== null ? (
            <View style={[styles.scoreChip, { backgroundColor: theme.colors.chipBg }]}>
              <Text style={[styles.scoreText, { color: theme.colors.primary }]}>{score}/10</Text>
            </View>
          ) : null}
          {tags.slice(0, 3).map((t) => (
            <View key={t} style={[styles.tag, { backgroundColor: theme.colors.chipBg }]}>
              <Text style={[styles.tagText, { color: theme.colors.textSecondary }]}>{t}</Text>
            </View>
          ))}
        </View>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  row: {
    padding: 14,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 8,
  },
  topLine: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  left: { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 },
  time: { fontSize: 12, fontWeight: '700', fontVariant: ['tabular-nums'] },
  subject: { fontSize: 15, fontWeight: '700', flexShrink: 1 },
  subItem: { fontSize: 13, fontWeight: '600', flexShrink: 1 },
  duration: { fontSize: 15, fontWeight: '800', fontVariant: ['tabular-nums'] },
  metaLine: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 },
  typeChip: { paddingHorizontal: 9, paddingVertical: 3, borderRadius: 999 },
  typeText: { fontSize: 11, fontWeight: '700' },
  scoreChip: { paddingHorizontal: 9, paddingVertical: 3, borderRadius: 999 },
  scoreText: { fontSize: 11, fontWeight: '800', fontVariant: ['tabular-nums'] },
  tag: { paddingHorizontal: 9, paddingVertical: 3, borderRadius: 999 },
  tagText: { fontSize: 11, fontWeight: '700' },
});

export const SessionRow = memo(SessionRowBase);
