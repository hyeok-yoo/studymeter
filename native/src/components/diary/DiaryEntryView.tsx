/**
 * DiaryEntryView — 확정된 일기의 컴팩트 표시. 웹 DiaryEntryView 미러.
 * 점수 · 하루 태그 · 나의 한마디 · AI 답장(있으면) · 자동 통계를 보여준다.
 * onEdit 을 주면 수정 진입 버튼이 뜬다(연결은 통합 단계 — 여기선 콜백만 노출).
 */
import { StyleSheet, Text, View } from 'react-native';
import { DisplayText } from '../DisplayText';
import { PressableScale } from '../PressableScale';
import { useTheme } from '../../theme/ThemeProvider';
import type { DiaryEntry } from '../../data/schema';
import { DiaryStatsRow } from './DiaryStatsRow';

type DiaryEntryViewProps = {
  entry: DiaryEntry;
  onEdit?: () => void;
};

export function DiaryEntryView({ entry, onEdit }: DiaryEntryViewProps) {
  const theme = useTheme();

  return (
    <View style={styles.root}>
      <View style={styles.headerRow}>
        <View style={styles.scoreRow}>
          <DisplayText size={32} color={theme.colors.primary}>
            {entry.score}
          </DisplayText>
          <Text style={[styles.outOf, { color: theme.colors.textSecondary }]}>/ 10</Text>
          {entry.auto ? (
            <View style={[styles.autoChip, { backgroundColor: theme.colors.chipBg }]}>
              <Text style={[styles.autoText, { color: theme.colors.textSecondary }]}>자동 확정</Text>
            </View>
          ) : null}
        </View>
        {onEdit ? (
          <PressableScale onPress={onEdit} strength="soft" accessibilityLabel="일기 수정">
            <View style={[styles.editChip, { backgroundColor: theme.colors.chipBg }]}>
              <Text style={[styles.editText, { color: theme.colors.textSecondary }]}>수정</Text>
            </View>
          </PressableScale>
        ) : null}
      </View>

      {entry.dayTags.length > 0 ? (
        <View style={styles.tagRow}>
          {entry.dayTags.map((t) => (
            <View key={t} style={[styles.tag, { backgroundColor: theme.colors.chipBg }]}>
              <Text style={[styles.tagText, { color: theme.colors.primary }]}>{t}</Text>
            </View>
          ))}
        </View>
      ) : null}

      {entry.oneLiner ? (
        <Text style={[styles.oneLiner, { color: theme.colors.text }]}>“{entry.oneLiner}”</Text>
      ) : null}

      {entry.aiReply ? (
        <View
          style={[
            styles.replyBox,
            { backgroundColor: theme.colors.chipBg, borderColor: theme.colors.glassBorder },
          ]}
        >
          <Text style={[styles.replyLabel, { color: theme.colors.textSecondary }]}>AI 답장</Text>
          <Text style={[styles.replyText, { color: theme.colors.text }]}>{entry.aiReply}</Text>
        </View>
      ) : null}

      <DiaryStatsRow stats={entry.stats} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: 14 },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  scoreRow: { flexDirection: 'row', alignItems: 'baseline', gap: 6 },
  outOf: { fontSize: 12, fontWeight: '700' },
  autoChip: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, marginLeft: 4 },
  autoText: { fontSize: 10, fontWeight: '700' },
  editChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999 },
  editText: { fontSize: 12, fontWeight: '700' },
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  tag: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999 },
  tagText: { fontSize: 11, fontWeight: '700' },
  oneLiner: { fontSize: 15, fontWeight: '600', lineHeight: 22 },
  replyBox: { padding: 12, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, gap: 4 },
  replyLabel: { fontSize: 10, fontWeight: '800', letterSpacing: 0.5 },
  replyText: { fontSize: 13, fontWeight: '500', lineHeight: 19 },
});
