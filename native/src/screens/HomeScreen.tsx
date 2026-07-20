/**
 * HomeScreen — 홈 셸. "오늘의 집중 시간" 히어로 숫자(더미) + 공부 시작 버튼.
 * 1단계 골격이므로 데이터는 하드코딩 0h 0m.
 */
import { StyleSheet, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { SafeAreaView } from 'react-native-safe-area-context';
import { DisplayText, GlassCard, PressableScale } from '../components';
import { useTheme } from '../theme/ThemeProvider';

export function HomeScreen() {
  const theme = useTheme();

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
            <DisplayText size={64}>0</DisplayText>
            <Text style={[styles.unit, { color: theme.colors.textSecondary }]}>h</Text>
            <DisplayText size={64}>0</DisplayText>
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
