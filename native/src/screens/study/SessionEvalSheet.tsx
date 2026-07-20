/**
 * SessionEvalSheet — 세션 종료 후 평가 시트.
 *
 * 웹 SessionEvalModal 의 핵심(점수 1~10 + 태그 칩 + 건너뛰기)을 이식한 축약본.
 * 태그는 localTags.ts 의 하드코딩 8개(통합 단계에서 tags 모듈로 교체 예정).
 * 저장 시 SessionEvaluation({ score, tags })을 상위로 넘긴다. 건너뛰면 그대로 이탈.
 */
import { useEffect, useState } from 'react';
import { Modal, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, SlideInDown } from 'react-native-reanimated';
import { PressableScale } from '../../components';
import { useTheme } from '../../theme/ThemeProvider';
import type { SessionEvaluation } from '../../data/schema';
import { SESSION_EVAL_TAGS } from './localTags';

type Props = {
  visible: boolean;
  subject: string;
  subItem?: string;
  durationMs: number;
  onSave: (evaluation: SessionEvaluation) => void;
  onSkip: () => void;
};

function formatKo(ms: number): string {
  const totalMinutes = Math.floor(ms / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0) return `${hours}시간 ${minutes}분`;
  return `${minutes}분`;
}

export function SessionEvalSheet({ visible, subject, subItem, durationMs, onSave, onSkip }: Props) {
  const theme = useTheme();
  const [score, setScore] = useState<number | null>(null);
  const [tags, setTags] = useState<string[]>([]);
  const sheetBg = theme.dark ? '#0d1526' : '#ffffff';

  // 열릴 때마다 초기화.
  useEffect(() => {
    if (!visible) return;
    setScore(null);
    setTags([]);
  }, [visible]);

  const toggleTag = (name: string) => {
    setTags((prev) => (prev.includes(name) ? prev.filter((t) => t !== name) : [...prev, name]));
  };

  const handleSave = () => {
    const evaluation: SessionEvaluation = {
      score: score ?? 7,
      tags,
    };
    onSave(evaluation);
  };

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onSkip}>
      <Animated.View
        entering={FadeIn.duration(200)}
        style={[styles.backdrop, { backgroundColor: theme.colors.scrim }]}
      />
      <View style={styles.sheetWrap} pointerEvents="box-none">
        <Animated.View
          entering={SlideInDown.springify().damping(18)}
          style={[styles.sheet, { backgroundColor: sheetBg, borderColor: theme.colors.border }]}
        >
          <View style={styles.headRow}>
            <Text style={[styles.subject, { color: theme.colors.primary }]}>
              {subItem ? `${subject} › ${subItem}` : subject}
            </Text>
            <Text style={[styles.dot, { color: theme.colors.textSecondary }]}>·</Text>
            <Text style={[styles.duration, { color: theme.colors.textSecondary }]}>
              {formatKo(durationMs)}
            </Text>
          </View>
          <Text style={[styles.title, { color: theme.colors.text }]}>이번 세션 어땠어?</Text>

          {/* 점수 1~10 */}
          <View style={styles.scoreRow}>
            {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => {
              const active = score !== null && n <= score;
              return (
                <PressableScale
                  key={n}
                  strength="strong"
                  onPress={() => setScore(n)}
                  style={[
                    styles.scoreCell,
                    active
                      ? { backgroundColor: theme.colors.primary }
                      : { backgroundColor: theme.colors.chipBg },
                  ]}
                >
                  <Text
                    style={[styles.scoreText, { color: active ? '#fff' : theme.colors.textSecondary }]}
                  >
                    {n}
                  </Text>
                </PressableScale>
              );
            })}
          </View>
          <Text style={[styles.scoreHint, { color: theme.colors.textSecondary }]}>
            {score === null ? '점수를 탭해 주세요 (건너뛰면 7점)' : `${score} / 10`}
          </Text>

          {/* 태그 칩 */}
          <View style={styles.tagRow}>
            {SESSION_EVAL_TAGS.map((name) => {
              const selected = tags.includes(name);
              return (
                <PressableScale
                  key={name}
                  strength="strong"
                  onPress={() => toggleTag(name)}
                  style={[
                    styles.tagChip,
                    selected
                      ? { backgroundColor: theme.colors.primary }
                      : { backgroundColor: theme.colors.chipBg },
                  ]}
                >
                  <Text
                    style={[styles.tagText, { color: selected ? '#fff' : theme.colors.textSecondary }]}
                  >
                    {name}
                  </Text>
                </PressableScale>
              );
            })}
          </View>

          {/* 액션 */}
          <View style={styles.actions}>
            <PressableScale
              onPress={onSkip}
              style={[styles.actionBtn, { backgroundColor: theme.colors.chipBg }]}
            >
              <Text style={[styles.actionText, { color: theme.colors.textSecondary }]}>
                건너뛰기
              </Text>
            </PressableScale>
            <PressableScale
              strength="strong"
              onPress={handleSave}
              style={[styles.actionBtn, styles.actionPrimary, { backgroundColor: theme.colors.primary }]}
            >
              <Text style={[styles.actionText, { color: '#fff' }]}>완료</Text>
            </PressableScale>
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  sheetWrap: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, justifyContent: 'flex-end' },
  sheet: {
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 24,
    paddingBottom: 32,
    gap: 12,
  },
  headRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  subject: { fontSize: 14, fontWeight: '800' },
  dot: { fontSize: 14, fontWeight: '800' },
  duration: { fontSize: 14, fontWeight: '700' },
  title: { fontSize: 22, fontWeight: '800', textAlign: 'center', letterSpacing: -0.4 },
  scoreRow: { flexDirection: 'row', gap: 5, marginTop: 4 },
  scoreCell: {
    flex: 1,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scoreText: { fontSize: 13, fontWeight: '800' },
  scoreHint: { fontSize: 13, fontWeight: '700', textAlign: 'center' },
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'center' },
  tagChip: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 999 },
  tagText: { fontSize: 13, fontWeight: '700' },
  actions: { flexDirection: 'row', gap: 12, marginTop: 8 },
  actionBtn: {
    flex: 1,
    paddingVertical: 16,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionPrimary: { flex: 1.4 },
  actionText: { fontSize: 14, fontWeight: '800' },
});
