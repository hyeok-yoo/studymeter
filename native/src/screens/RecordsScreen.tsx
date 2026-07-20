/**
 * RecordsScreen — 기록 화면. 웹 src/pages/Records.tsx 의 정보 구조를 네이티브로 이식.
 *
 * 상단 세그먼트(일별 / 주별 / 일기, 선택 배경이 스프링으로 이동):
 *  - 일별: 날짜 네비(◀ 날짜 ▶) + 총시간·순공시간 요약 + 세션 리스트
 *  - 주별: 최근 7일 막대 그래프(차트 라이브러리 없이 View 높이로 직접 구현)
 *  - 일기: getDiaryRange 로 최근 일기 목록(점수·한마디·태그)
 *
 * 규칙: 색은 useTheme() 토큰, 날짜는 dao 헬퍼(toISOString 금지), DB 비어도 빈 상태 UI.
 */
import { useCallback, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import * as Haptics from 'expo-haptics';
import { SafeAreaView } from 'react-native-safe-area-context';
import Animated, { FadeIn } from 'react-native-reanimated';
import { DisplayText, GlassCard, PressableScale } from '../components';
import { useTheme } from '../theme/ThemeProvider';
import { initDatabase } from '../data/db';
import {
  getSessionsByDate,
  getDiaryRange,
  getStudyToday,
  getTodayDate,
  formatDateYYYYMMDD,
  formatDurationHourMinute,
} from '../data/dao';
import type { StudySession, DiaryEntry } from '../data/schema';
import { Segmented } from './records/Segmented';
import { SessionRow } from './records/SessionRow';
import { WeekBars, type WeekBarDatum } from './records/WeekBars';
import { DiaryRow } from './records/DiaryRow';

type Tab = 'day' | 'week' | 'diary';

const SEGMENTS = [
  { key: 'day' as const, label: '일별' },
  { key: 'week' as const, label: '주별' },
  { key: 'diary' as const, label: '일기' },
];

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

function formatDateKorean(d: Date): string {
  return `${d.getMonth() + 1}월 ${d.getDate()}일 (${WEEKDAYS[d.getDay()]})`;
}

const SELF_STUDY_TYPES = new Set(['자습', '테스트']);

export function RecordsScreen() {
  const theme = useTheme();
  const [tab, setTab] = useState<Tab>('day');
  const [dayOffset, setDayOffset] = useState(0); // 0 = 오늘, 음수 = 과거

  const [daySessions, setDaySessions] = useState<StudySession[]>([]);
  const [weekData, setWeekData] = useState<WeekBarDatum[]>([]);
  const [diaries, setDiaries] = useState<DiaryEntry[]>([]);

  // 대상 날짜(일별) — dao 헬퍼로 계산(toISOString 금지).
  const targetDate = useMemo(() => {
    const d = getStudyToday();
    d.setDate(d.getDate() + dayOffset);
    return d;
  }, [dayOffset]);
  const targetDateStr = useMemo(() => formatDateYYYYMMDD(targetDate), [targetDate]);

  // 데이터 로딩 — 탭/날짜가 바뀔 때, 화면에 진입할 때.
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      (async () => {
        try {
          await initDatabase();
          if (tab === 'day') {
            const sessions = await getSessionsByDate(targetDateStr);
            if (!cancelled) setDaySessions(sessions);
          } else if (tab === 'week') {
            // 최근 7일(오늘 포함). 각 날짜별 세션 합산.
            const today = getStudyToday();
            const days: Date[] = [];
            for (let i = 6; i >= 0; i--) {
              const d = new Date(today);
              d.setDate(d.getDate() - i);
              days.push(d);
            }
            const todayStr = getTodayDate();
            const perDay = await Promise.all(
              days.map((d) => getSessionsByDate(formatDateYYYYMMDD(d)))
            );
            if (cancelled) return;
            const data: WeekBarDatum[] = days.map((d, i) => {
              const dateStr = formatDateYYYYMMDD(d);
              let totalMs = 0;
              let selfMs = 0;
              for (const s of perDay[i]) {
                totalMs += s.duration;
                if (SELF_STUDY_TYPES.has(s.type)) selfMs += s.duration;
              }
              return {
                date: dateStr,
                label: WEEKDAYS[d.getDay()],
                totalMs,
                selfMs,
                isToday: dateStr === todayStr,
              };
            });
            setWeekData(data);
          } else {
            // 일기: 최근 1년 범위 → 최신순.
            const start = getStudyToday();
            start.setDate(start.getDate() - 365);
            const list = await getDiaryRange(formatDateYYYYMMDD(start), getTodayDate());
            if (cancelled) return;
            list.sort((a, b) => b.date.localeCompare(a.date));
            setDiaries(list);
          }
        } catch {
          if (cancelled) return;
          setDaySessions([]);
          setWeekData([]);
          setDiaries([]);
        }
      })();
      return () => {
        cancelled = true;
      };
    }, [tab, targetDateStr])
  );

  const { totalMs, selfMs } = useMemo(() => {
    let total = 0;
    let self = 0;
    for (const s of daySessions) {
      total += s.duration;
      if (SELF_STUDY_TYPES.has(s.type)) self += s.duration;
    }
    return { totalMs: total, selfMs: self };
  }, [daySessions]);

  const goPrev = () => {
    void Haptics.selectionAsync();
    setDayOffset((o) => o - 1);
  };
  const goNext = () => {
    if (dayOffset >= 0) return;
    void Haptics.selectionAsync();
    setDayOffset((o) => Math.min(o + 1, 0));
  };

  const orderedSessions = useMemo(
    () => [...daySessions].sort((a, b) => a.startTime - b.startTime),
    [daySessions]
  );

  return (
    <SafeAreaView
      edges={['top', 'left', 'right']}
      style={[styles.root, { backgroundColor: theme.colors.bg }]}
    >
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={[styles.title, { color: theme.colors.text }]}>기록</Text>

        <Segmented segments={SEGMENTS} value={tab} onChange={setTab} />

        {tab === 'day' ? (
          <Animated.View key="day" entering={FadeIn.duration(220)} style={styles.section}>
            {/* 날짜 네비 */}
            <View style={styles.dateNav}>
              <PressableScale onPress={goPrev} strength="strong" accessibilityLabel="이전 날">
                <View style={[styles.navBtn, { backgroundColor: theme.colors.chipBg }]}>
                  <Text style={[styles.navGlyph, { color: theme.colors.text }]}>‹</Text>
                </View>
              </PressableScale>
              <Text style={[styles.dateLabel, { color: theme.colors.text }]}>
                {formatDateKorean(targetDate)}
              </Text>
              <PressableScale
                onPress={goNext}
                strength="strong"
                disabled={dayOffset >= 0}
                accessibilityLabel="다음 날"
              >
                <View style={[styles.navBtn, { backgroundColor: theme.colors.chipBg }]}>
                  <Text style={[styles.navGlyph, { color: theme.colors.text }]}>›</Text>
                </View>
              </PressableScale>
            </View>

            {/* 요약: 총시간 / 순공시간 */}
            <View style={styles.summaryRow}>
              <GlassCard style={styles.summaryCard} radius={theme.radius.lg}>
                <Text style={[styles.summaryLabel, { color: theme.colors.textSecondary }]}>
                  총 공부 시간
                </Text>
                <DisplayText size={30} color={theme.colors.primary}>
                  {formatDurationHourMinute(totalMs)}
                </DisplayText>
              </GlassCard>
              <GlassCard style={styles.summaryCard} radius={theme.radius.lg}>
                <Text style={[styles.summaryLabel, { color: theme.colors.textSecondary }]}>
                  순공 시간
                </Text>
                <DisplayText size={30}>{formatDurationHourMinute(selfMs)}</DisplayText>
              </GlassCard>
            </View>

            {/* 세션 리스트 */}
            <View style={styles.list}>
              {orderedSessions.length > 0 ? (
                orderedSessions.map((s, i) => (
                  <SessionRow key={s.id ?? i} session={s} delay={Math.min(i, 6) * 40} />
                ))
              ) : (
                <EmptyState theme={theme} text="이 날의 공부 기록이 없어요." />
              )}
            </View>
          </Animated.View>
        ) : null}

        {tab === 'week' ? (
          <Animated.View key="week" entering={FadeIn.duration(220)} style={styles.section}>
            <GlassCard radius={theme.radius.lg}>
              <Text style={[styles.cardTitle, { color: theme.colors.text }]}>최근 7일</Text>
              <View style={{ height: theme.spacing.md }} />
              <WeekBars data={weekData} />
            </GlassCard>
          </Animated.View>
        ) : null}

        {tab === 'diary' ? (
          <Animated.View key="diary" entering={FadeIn.duration(220)} style={styles.section}>
            {diaries.length > 0 ? (
              <View style={styles.list}>
                {diaries.map((entry, i) => (
                  <DiaryRow key={entry.date} entry={entry} delay={Math.min(i, 6) * 40} />
                ))}
              </View>
            ) : (
              <EmptyState theme={theme} text="아직 작성된 일기가 없어요." />
            )}
          </Animated.View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function EmptyState({ theme, text }: { theme: ReturnType<typeof useTheme>; text: string }) {
  return (
    <GlassCard style={styles.empty} radius={theme.radius.lg}>
      <Text style={[styles.emptyText, { color: theme.colors.textSecondary }]}>{text}</Text>
    </GlassCard>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 32, gap: 16 },
  title: { fontSize: 30, fontWeight: '800', letterSpacing: -0.5 },
  section: { gap: 16 },
  dateNav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  navBtn: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  navGlyph: { fontSize: 26, fontWeight: '700', lineHeight: 30 },
  dateLabel: { fontSize: 17, fontWeight: '800', fontVariant: ['tabular-nums'] },
  summaryRow: { flexDirection: 'row', gap: 12 },
  summaryCard: { flex: 1, gap: 6, paddingVertical: 18 },
  summaryLabel: { fontSize: 12, fontWeight: '700', letterSpacing: 0.5 },
  list: { gap: 10 },
  cardTitle: { fontSize: 16, fontWeight: '800' },
  empty: { alignItems: 'center', paddingVertical: 36 },
  emptyText: { fontSize: 14, fontWeight: '500', fontStyle: 'italic' },
});
