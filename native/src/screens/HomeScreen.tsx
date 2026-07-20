/**
 * HomeScreen — 홈 화면. 웹 src/pages/Home.tsx 의 정보 구조를 네이티브 감각으로 이식.
 *
 * 구성(위→아래):
 *  1. 인사 헤더 — dao.getSettings()?.userName ?? '학생'
 *  2. "오늘의 집중 시간" 히어로 — DisplayText 초대형(getTodayTotalStudyTime)
 *  3. 과목별 시간 칩 — getTodayStudyTimeBySubject (SubjectChip memo)
 *  4. 공부 시작 버튼 — 햅틱 + 눌림(타이머는 이후 단계)
 *  5. 오늘의 일기 카드 골격 — getDiaryEntry(getTodayDate())
 *
 * 규칙: 색은 useTheme() 토큰, 등장은 FadeInDown 스프링, DB 비어도 빈 상태 UI.
 */
import { useCallback, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import * as Haptics from 'expo-haptics';
import { SafeAreaView } from 'react-native-safe-area-context';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { DisplayText, GlassCard, PressableScale } from '../components';
import { useTheme } from '../theme/ThemeProvider';
import { initDatabase } from '../data/db';
import {
  getTodayTotalStudyTime,
  getTodayStudyTimeBySubject,
  getDiaryEntry,
  getSettings,
  getTodayDate,
} from '../data/dao';
import type { DiaryEntry, Settings } from '../data/schema';
import { SubjectChip } from './home/SubjectChip';
import { TodayDiaryCard } from './home/TodayDiaryCard';
import { StartStudySheet } from './study/StartStudySheet';
import type { RootStackParamList, StudyParams } from './study/types';
import { MorningReportCard } from '../components/MorningReportCard';
import { DiaryEditorSheet, collectSessionTags, computeDiaryStats } from '../components/diary';
import { generateDiaryDraft, isAmbientAiEnabled } from '../ai';

type SubjectTime = { subject: string; total: number };

export function HomeScreen() {
  const theme = useTheme();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();

  const [userName, setUserName] = useState('학생');
  const [todayMs, setTodayMs] = useState(0);
  const [subjects, setSubjects] = useState<SubjectTime[]>([]);
  const [diary, setDiary] = useState<DiaryEntry | undefined>(undefined);
  const [showStart, setShowStart] = useState(false);
  const [settings, setSettings] = useState<Settings | undefined>(undefined);
  const [showDiarySheet, setShowDiarySheet] = useState(false);
  const [diaryDraft, setDiaryDraft] = useState<string | undefined>(undefined);
  const [diaryTags, setDiaryTags] = useState<string[]>([]);

  // 홈 탭에 진입할 때마다 최신 데이터로 새로고침(기록/편집 후 돌아오는 경우 반영).
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      (async () => {
        try {
          await initDatabase();
          const [ms, bySubject, settings, todayDiary] = await Promise.all([
            getTodayTotalStudyTime(),
            getTodayStudyTimeBySubject(),
            getSettings(),
            getDiaryEntry(getTodayDate()),
          ]);
          if (cancelled) return;
          setTodayMs(ms);
          setSubjects(
            Array.from(bySubject.entries())
              .map(([subject, t]) => ({ subject, total: t.total }))
              .sort((a, b) => b.total - a.total)
          );
          setUserName(settings?.userName?.trim() || '학생');
          setSettings(settings);
          setDiary(todayDiary);
        } catch {
          if (cancelled) return;
          setTodayMs(0);
          setSubjects([]);
          setDiary(undefined);
        }
      })();
      return () => {
        cancelled = true;
      };
    }, [])
  );

  const { hours, minutes } = useMemo(() => {
    const totalMinutes = Math.floor(todayMs / 60000);
    return { hours: Math.floor(totalMinutes / 60), minutes: totalMinutes % 60 };
  }, [todayMs]);

  const onStart = () => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setShowStart(true);
  };

  const onStartConfirm = useCallback(
    (params: StudyParams) => {
      setShowStart(false);
      navigation.navigate('Study', params);
    },
    [navigation]
  );

  // 일기 카드 탭 → 편집 시트. 세션 태그 승계 + (가능하면) AI 초안을 비동기로 준비.
  const openDiarySheet = useCallback(() => {
    if (!settings) return;
    setShowDiarySheet(true);
    const today = getTodayDate();
    void (async () => {
      try {
        const tags = await collectSessionTags(today);
        setDiaryTags(tags);
        if (!diary?.oneLiner && isAmbientAiEnabled(settings)) {
          const stats = await computeDiaryStats(today, settings.dailyGoalMs);
          const draft = await generateDiaryDraft(settings, today, stats);
          setDiaryDraft(draft || undefined);
        }
      } catch {
        /* 초안 실패는 조용히 무시 — 규칙 기반 폴백이 시트 안에 있다 */
      }
    })();
  }, [settings, diary]);

  const onDiarySaved = useCallback(async () => {
    setShowDiarySheet(false);
    const fresh = await getDiaryEntry(getTodayDate()).catch(() => undefined);
    setDiary(fresh);
  }, []);

  return (
    <SafeAreaView
      edges={['top', 'left', 'right']}
      style={[styles.root, { backgroundColor: theme.colors.bg }]}
    >
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {/* 1. 인사 헤더 */}
        <Animated.View entering={FadeInDown.springify()} style={styles.header}>
          <Text style={[styles.greeting, { color: theme.colors.text }]}>
            안녕하세요, <Text style={{ color: theme.colors.primary }}>{userName}</Text>님
          </Text>
          <Text style={[styles.subGreeting, { color: theme.colors.textSecondary }]}>
            오늘도 한 걸음씩 나아가 볼까요?
          </Text>
        </Animated.View>

        {/* 1.5 아침 브리핑 / 주간 리뷰 (앰비언트 AI 켜져 있을 때만 내용 표시) */}
        <Animated.View entering={FadeInDown.springify().delay(30)}>
          <MorningReportCard settings={settings} />
        </Animated.View>

        {/* 2. 히어로 — 오늘의 집중 시간 */}
        <Animated.View entering={FadeInDown.springify().delay(60)}>
          <GlassCard style={styles.hero}>
            <Text style={[styles.heroLabel, { color: theme.colors.textSecondary }]}>
              오늘의 집중 시간
            </Text>
            <View style={styles.timeRow}>
              <DisplayText size={72} color={theme.colors.primary}>
                {String(hours)}
              </DisplayText>
              <Text style={[styles.unit, { color: theme.colors.textSecondary }]}>h</Text>
              <DisplayText size={72}>{String(minutes)}</DisplayText>
              <Text style={[styles.unit, { color: theme.colors.textSecondary }]}>m</Text>
            </View>
            <View style={[styles.accentBar, { backgroundColor: theme.colors.primary }]} />

            {/* 3. 과목별 시간 칩 */}
            <View style={styles.chipRow}>
              {subjects.length > 0 ? (
                subjects.map((s, i) => (
                  <SubjectChip
                    key={s.subject}
                    subject={s.subject}
                    totalMs={s.total}
                    delay={i * 40}
                  />
                ))
              ) : (
                <Text style={[styles.emptyChips, { color: theme.colors.textSecondary }]}>
                  기록을 시작하면 과목별 통계가 여기에 나타나요.
                </Text>
              )}
            </View>
          </GlassCard>
        </Animated.View>

        {/* 4. 공부 시작 버튼 */}
        <Animated.View entering={FadeInDown.springify().delay(120)}>
          <PressableScale
            onPress={onStart}
            strength="soft"
            accessibilityLabel="공부 시작하기"
          >
            <View style={[styles.cta, { backgroundColor: theme.colors.primary }]}>
              <Text style={styles.ctaText}>공부 시작하기</Text>
            </View>
          </PressableScale>
        </Animated.View>

        {/* 5. 오늘의 일기 카드 */}
        <Animated.View entering={FadeInDown.springify().delay(180)}>
          <TodayDiaryCard entry={diary} onPress={openDiarySheet} />
        </Animated.View>
      </ScrollView>

      {/* 공부 시작 선택 시트 */}
      <StartStudySheet
        visible={showStart}
        onClose={() => setShowStart(false)}
        onConfirm={onStartConfirm}
      />

      {/* 오늘 일기 편집 시트 */}
      {settings && (
        <DiaryEditorSheet
          visible={showDiarySheet}
          onClose={() => setShowDiarySheet(false)}
          date={getTodayDate()}
          settings={settings}
          existing={diary}
          draft={diaryDraft}
          inheritedTags={diaryTags}
          onSaved={onDiarySaved}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 32, gap: 20 },
  header: { gap: 4 },
  greeting: { fontSize: 28, fontWeight: '800', letterSpacing: -0.5 },
  subGreeting: { fontSize: 15, fontWeight: '600' },
  hero: { alignItems: 'flex-start', gap: 10, paddingVertical: 28 },
  heroLabel: { fontSize: 13, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase' },
  timeRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 2 },
  unit: { fontSize: 24, fontWeight: '700', marginBottom: 12, marginHorizontal: 4 },
  accentBar: { height: 5, width: 72, borderRadius: 999, marginTop: 2 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  emptyChips: { fontSize: 13, fontWeight: '500', fontStyle: 'italic' },
  cta: {
    borderRadius: 20,
    paddingVertical: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaText: { color: '#ffffff', fontSize: 17, fontWeight: '700' },
});
