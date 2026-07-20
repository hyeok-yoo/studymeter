/**
 * HomeScreen — 홈 셸. "오늘의 집중 시간" 히어로 숫자 + 공부 시작 버튼.
 * 2단계: 히어로 숫자를 dao.getTodayTotalStudyTime() 실데이터로 연결(DB 비면 0h 0m).
 */
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { SafeAreaView } from 'react-native-safe-area-context';
import { DisplayText, GlassCard, PressableScale } from '../components';
import { useTheme } from '../theme/ThemeProvider';
import { initDatabase } from '../data/db';
import { getTodayTotalStudyTime } from '../data/dao';

export function HomeScreen() {
  const theme = useTheme();

  // 오늘 총 공부 시간(ms). DB 초기화 후 조회하고, 비어 있으면 0 → 0h 0m.
  const [todayMs, setTodayMs] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await initDatabase();
        const ms = await getTodayTotalStudyTime();
        if (!cancelled) setTodayMs(ms);
      } catch {
        if (!cancelled) setTodayMs(0);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const totalMinutes = Math.floor(todayMs / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  const onStart = () => {
    // 촉각 피드백 — 실제 타이머 로직은 이후 단계에서.
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  };

  return (
    <SafeAreaView
      edges={['top', 'left', 'right']}
      style={[styles.root, { backgroundColor: theme.colors.bg }]}
    >
      <View style={styles.content}>
        <Text style={[styles.greeting, { color: theme.colors.textSecondary }]}>StudyMeter</Text>

        <GlassCard style={styles.hero}>
          <Text style={[styles.label, { color: theme.colors.textSecondary }]}>오늘의 집중 시간</Text>
          <View style={styles.timeRow}>
            <DisplayText size={64}>{String(hours)}</DisplayText>
            <Text style={[styles.unit, { color: theme.colors.textSecondary }]}>h</Text>
            <DisplayText size={64}>{String(minutes)}</DisplayText>
            <Text style={[styles.unit, { color: theme.colors.textSecondary }]}>m</Text>
          </View>
        </GlassCard>

        <PressableScale onPress={onStart} accessibilityLabel="공부 시작하기" style={styles.ctaWrap}>
          <View style={[styles.cta, { backgroundColor: theme.colors.primary }]}>
            <Text style={styles.ctaText}>공부 시작하기</Text>
          </View>
        </PressableScale>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { flex: 1, paddingHorizontal: 20, paddingTop: 12, gap: 24 },
  greeting: { fontSize: 15, fontWeight: '600', letterSpacing: 0.5 },
  hero: { alignItems: 'flex-start', gap: 8, paddingVertical: 28 },
  label: { fontSize: 15, fontWeight: '600' },
  timeRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 4 },
  unit: { fontSize: 22, fontWeight: '700', marginBottom: 10, marginRight: 6 },
  ctaWrap: { alignSelf: 'stretch' },
  cta: {
    borderRadius: 20,
    paddingVertical: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaText: { color: '#ffffff', fontSize: 17, fontWeight: '700' },
});
