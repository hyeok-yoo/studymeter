/**
 * DiaryEditorSheet.tsx — 일기 편집 바텀시트. 웹 DiaryEditModal(DiaryEditor) 미러.
 *
 * 점수(1~10 버튼, 제안값 suggestDiaryScore) · 하루 태그(상위 8개 + 더보기 카테고리) ·
 * 나의 한마디(직접 입력 — AI 초안은 optional prop `draft` 로만 받고, 없으면 규칙
 * 기반 초안 ruleBasedDiaryDraft 로 채운다. AI 초안 생성 자체는 다른 에이전트 몫) ·
 * 확정(dao.saveDiaryEntry + recordTagUsage)까지 담당한다.
 *
 * stats 는 dao 에 computeDiaryStats 상당 함수가 없어(dao.ts 는 다른 에이전트와 충돌
 * 위험이 있어 수정하지 않음) 같은 폴더의 diaryStats.ts 에서 세션을 직접 집계해 계산한다.
 */
import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { PressableScale } from '../PressableScale';
import { useTheme } from '../../theme/ThemeProvider';
import { saveDiaryEntry } from '../../data/dao';
import type { DiaryEntry, DiaryStats, EvalTag, Settings } from '../../data/schema';
import { getTagsForScope, getTopTags, recordTagUsage, TAG_CATEGORY_LABELS } from '../../data/tags';
import { BottomSheet } from '../sheets/BottomSheet';
import { DiaryStatsRow } from './DiaryStatsRow';
import { computeDiaryStats, EMPTY_DIARY_STATS, ruleBasedDiaryDraft, suggestDiaryScore } from './diaryStats';

export type DiaryEditorSheetProps = {
  visible: boolean;
  onClose: () => void;
  date: string;
  settings: Settings;
  existing?: DiaryEntry;
  /** AI 초안 — 다른 에이전트가 채워줄 몫. 없으면 규칙 기반 초안(ruleBasedDiaryDraft)을 쓴다. */
  draft?: string;
  /** 세션 태그 승계 등 외부에서 미리 골라둔 태그. */
  inheritedTags?: string[];
  onSaved: () => void | Promise<void>;
};

const SCORES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

export function DiaryEditorSheet({
  visible,
  onClose,
  date,
  settings,
  existing,
  draft,
  inheritedTags = [],
  onSaved,
}: DiaryEditorSheetProps) {
  const theme = useTheme();
  const [stats, setStats] = useState<DiaryStats>(EMPTY_DIARY_STATS);
  const [loadingStats, setLoadingStats] = useState(true);
  const [score, setScore] = useState(existing?.score ?? 5);
  const [selectedTags, setSelectedTags] = useState<string[]>(existing?.dayTags ?? inheritedTags);
  const [showAllTags, setShowAllTags] = useState(false);
  const [oneLiner, setOneLiner] = useState(existing?.oneLiner ?? draft ?? '');
  const [source, setSource] = useState<DiaryEntry['oneLinerSource']>(existing?.oneLinerSource ?? 'user');
  const [saving, setSaving] = useState(false);

  // 시트가 열릴 때(또는 날짜가 바뀔 때) 폼을 리셋하고, 자동 통계를 다시 집계한다.
  useEffect(() => {
    if (!visible) return;
    let cancelled = false;

    setLoadingStats(true);
    setScore(existing?.score ?? 5);
    const merged = Array.from(new Set([...inheritedTags, ...(existing?.dayTags ?? [])]));
    setSelectedTags(merged);
    setOneLiner(existing?.oneLiner ?? draft ?? '');
    setSource(existing?.oneLinerSource ?? (draft ? 'ai' : 'user'));
    setShowAllTags(false);

    computeDiaryStats(date, settings.dailyGoalMs)
      .then((s) => {
        if (cancelled) return;
        setStats(s);
        if (!existing) {
          setScore(suggestDiaryScore(s));
          setOneLiner((prev) => (prev ? prev : draft ?? ruleBasedDiaryDraft(s)));
        }
      })
      .catch(() => {
        if (!cancelled) setStats(EMPTY_DIARY_STATS);
      })
      .finally(() => {
        if (!cancelled) setLoadingStats(false);
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, date]);

  const toggleTag = (name: string) => {
    void Haptics.selectionAsync();
    setSelectedTags((prev) => (prev.includes(name) ? prev.filter((t) => t !== name) : [...prev, name]));
  };

  const topTags: EvalTag[] = getTopTags(settings, 'day', 8, selectedTags);
  const allTagsByCategory: Array<[EvalTag['category'], EvalTag[]]> = (
    Object.keys(TAG_CATEGORY_LABELS) as EvalTag['category'][]
  )
    .map(
      (cat) =>
        [cat, getTagsForScope(settings, 'day').filter((t) => t.category === cat)] as [
          EvalTag['category'],
          EvalTag[],
        ]
    )
    .filter(([, tags]) => tags.length > 0);

  const handleConfirm = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const trimmed = oneLiner.trim();
      const now = Date.now();
      // 확정 시점 기준으로 통계를 재계산 (시트 오픈 이후 세션이 추가됐을 수 있음)
      const freshStats = await computeDiaryStats(date, settings.dailyGoalMs).catch(() => stats);
      const entry: DiaryEntry = {
        date,
        score,
        dayTags: selectedTags,
        oneLiner: trimmed || undefined,
        oneLinerSource: trimmed ? source : undefined,
        aiReply: existing?.aiReply,
        auto: false,
        stats: freshStats,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      };
      await saveDiaryEntry(entry);
      recordTagUsage(selectedTags);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      await onSaved();
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <BottomSheet visible={visible} onClose={onClose}>
      <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <Animated.View entering={FadeInDown.springify()} style={styles.root}>
          <Text style={[styles.title, { color: theme.colors.text }]}>{date} 일기</Text>

          <DiaryStatsRow stats={loadingStats ? EMPTY_DIARY_STATS : stats} />

          <View style={styles.section}>
            <Text style={[styles.sectionLabel, { color: theme.colors.textSecondary }]}>오늘 점수</Text>
            <View style={styles.scoreRow}>
              {SCORES.map((n) => {
                const active = n <= score;
                return (
                  <PressableScale
                    key={n}
                    onPress={() => setScore(n)}
                    strength="soft"
                    style={styles.scoreBtnWrap}
                  >
                    <View
                      style={[
                        styles.scoreBtn,
                        { backgroundColor: active ? theme.colors.primary : theme.colors.chipBg },
                      ]}
                    >
                      <Text
                        style={[
                          styles.scoreBtnText,
                          { color: active ? '#ffffff' : theme.colors.textSecondary },
                        ]}
                      >
                        {n}
                      </Text>
                    </View>
                  </PressableScale>
                );
              })}
            </View>
          </View>

          <View style={styles.section}>
            <Text style={[styles.sectionLabel, { color: theme.colors.textSecondary }]}>하루 태그</Text>
            <View style={styles.tagWrap}>
              {topTags.map((tag) => {
                const selected = selectedTags.includes(tag.name);
                return (
                  <PressableScale key={tag.name} onPress={() => toggleTag(tag.name)} strength="soft">
                    <View
                      style={[
                        styles.tagChip,
                        { backgroundColor: selected ? theme.colors.primary : theme.colors.chipBg },
                      ]}
                    >
                      <Text
                        style={[
                          styles.tagChipText,
                          { color: selected ? '#ffffff' : theme.colors.textSecondary },
                        ]}
                      >
                        {tag.name}
                      </Text>
                    </View>
                  </PressableScale>
                );
              })}
              <PressableScale onPress={() => setShowAllTags((v) => !v)} strength="soft">
                <View style={[styles.tagChip, { backgroundColor: theme.colors.chipBg }]}>
                  <Text style={[styles.tagChipText, { color: theme.colors.textSecondary }]}>
                    {showAllTags ? '접기' : '더보기'}
                  </Text>
                </View>
              </PressableScale>
            </View>

            {showAllTags ? (
              <View style={styles.categoryList}>
                {allTagsByCategory.map(([cat, tags]) => (
                  <View key={cat} style={styles.categoryBlock}>
                    <Text style={[styles.categoryLabel, { color: theme.colors.textSecondary }]}>
                      {TAG_CATEGORY_LABELS[cat]}
                    </Text>
                    <View style={styles.tagWrap}>
                      {tags.map((tag) => {
                        const selected = selectedTags.includes(tag.name);
                        return (
                          <PressableScale key={tag.name} onPress={() => toggleTag(tag.name)} strength="soft">
                            <View
                              style={[
                                styles.tagChipSmall,
                                { backgroundColor: selected ? theme.colors.primary : theme.colors.chipBg },
                              ]}
                            >
                              <Text
                                style={[
                                  styles.tagChipText,
                                  { color: selected ? '#ffffff' : theme.colors.textSecondary },
                                ]}
                              >
                                {tag.name}
                              </Text>
                            </View>
                          </PressableScale>
                        );
                      })}
                    </View>
                  </View>
                ))}
              </View>
            ) : null}
          </View>

          <View style={styles.section}>
            <View style={styles.oneLinerHeader}>
              <Text style={[styles.sectionLabel, { color: theme.colors.textSecondary }]}>나의 한마디</Text>
              {source === 'ai' ? (
                <Text style={[styles.sourceHint, { color: theme.colors.primary }]}>AI 초안</Text>
              ) : null}
            </View>
            <TextInput
              value={oneLiner}
              onChangeText={(v) => {
                setOneLiner(v);
                setSource(draft && draft.trim() ? 'ai-edited' : 'user');
              }}
              placeholder="오늘 하루를 한마디로 남겨보세요"
              placeholderTextColor={theme.colors.textSecondary}
              multiline
              style={[
                styles.textInput,
                {
                  color: theme.colors.text,
                  backgroundColor: theme.colors.chipBg,
                  borderColor: theme.colors.glassBorder,
                },
              ]}
            />
            {draft && draft.trim() && oneLiner !== draft ? (
              <PressableScale
                onPress={() => {
                  setOneLiner(draft);
                  setSource('ai');
                }}
                strength="soft"
              >
                <View style={[styles.draftBtn, { backgroundColor: theme.colors.chipBg }]}>
                  <Text style={[styles.draftBtnText, { color: theme.colors.textSecondary }]}>
                    초안 그대로 쓰기
                  </Text>
                </View>
              </PressableScale>
            ) : null}
          </View>

          <View style={styles.actionsRow}>
            <PressableScale onPress={onClose} strength="soft" disabled={saving} style={styles.actionFlex}>
              <View style={[styles.cancelBtn, { backgroundColor: theme.colors.chipBg }]}>
                <Text style={[styles.cancelText, { color: theme.colors.textSecondary }]}>취소</Text>
              </View>
            </PressableScale>
            <PressableScale
              onPress={handleConfirm}
              strength="soft"
              disabled={saving}
              style={styles.actionFlexWide}
            >
              <View style={[styles.confirmBtn, { backgroundColor: theme.colors.primary }]}>
                <Text style={styles.confirmText}>{existing ? '수정 완료' : '오늘 일기 확정'}</Text>
              </View>
            </PressableScale>
          </View>
        </Animated.View>
      </ScrollView>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  root: { gap: 20, paddingBottom: 24 },
  title: { fontSize: 18, fontWeight: '800' },
  section: { gap: 10 },
  sectionLabel: { fontSize: 11, fontWeight: '800', letterSpacing: 0.6, textTransform: 'uppercase' },
  scoreRow: { flexDirection: 'row', gap: 6, height: 44 },
  scoreBtnWrap: { flex: 1 },
  scoreBtn: { flex: 1, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  scoreBtnText: { fontSize: 13, fontWeight: '800' },
  tagWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tagChip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999 },
  tagChipSmall: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999 },
  tagChipText: { fontSize: 12, fontWeight: '700' },
  categoryList: { gap: 12, paddingTop: 4 },
  categoryBlock: { gap: 6 },
  categoryLabel: { fontSize: 10, fontWeight: '800', letterSpacing: 0.5 },
  oneLinerHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sourceHint: { fontSize: 11, fontWeight: '700' },
  textInput: {
    minHeight: 56,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 14,
    fontWeight: '500',
    lineHeight: 20,
    textAlignVertical: 'top',
  },
  draftBtn: { alignSelf: 'flex-start', paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999 },
  draftBtnText: { fontSize: 11, fontWeight: '700' },
  actionsRow: { flexDirection: 'row', gap: 10 },
  actionFlex: { flex: 1 },
  actionFlexWide: { flex: 1.6 },
  cancelBtn: { paddingVertical: 15, borderRadius: 18, alignItems: 'center' },
  cancelText: { fontSize: 14, fontWeight: '800' },
  confirmBtn: { paddingVertical: 15, borderRadius: 18, alignItems: 'center' },
  confirmText: { fontSize: 14, fontWeight: '800', color: '#ffffff' },
});
