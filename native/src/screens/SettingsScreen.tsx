/**
 * SettingsScreen — 설정 탭 (3단계: 설정 화면 + 데이터 마이그레이션 UI).
 *
 * iOS 설정 감각의 그룹 섹션: SectionLabel + GlassCard 안에 SettingsRow.
 * 프로필 / 학습 목표는 blur·제출 시점에 saveSettings, 과목·유형은 읽기 전용
 * (편집은 다음 단계), 데이터 섹션은 웹앱 백업 JSON 가져오기(핵심 기능), 정보는
 * 앱 버전 + 네이티브 베타 배지.
 *
 * refreshKey: 백업 가져오기로 설정이 통째로 바뀌면 ProfileSection/GoalSection 의
 * 내부 텍스트 입력 상태를 새 값으로 리셋해야 한다. key 를 바꿔 강제 리마운트한다.
 */
import { useCallback, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { ScreenShell } from './ScreenShell';
import { useTheme } from '../theme/ThemeProvider';
import {
  useSettingsData,
  ProfileSection,
  GoalSection,
  SubjectsSection,
  DataSection,
  AboutSection,
} from './settings';

export function SettingsScreen() {
  const theme = useTheme();
  const { settings, loading, error, update, reload } = useSettingsData();
  const [refreshKey, setRefreshKey] = useState(0);

  const handleImported = useCallback(async () => {
    await reload();
    setRefreshKey((k) => k + 1);
  }, [reload]);

  return (
    <ScreenShell title="설정" subtitle="프로필 · 학습 목표 · 데이터 관리">
      {loading || !settings ? (
        <View style={styles.centerFill}>
          <ActivityIndicator color={theme.colors.primary} />
          {error ? (
            <Text style={[styles.errorText, { color: theme.colors.textSecondary }]}>{error}</Text>
          ) : null}
        </View>
      ) : (
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          <ProfileSection key={`profile-${refreshKey}`} settings={settings} onUpdate={update} />
          <GoalSection key={`goal-${refreshKey}`} settings={settings} onUpdate={update} />
          <SubjectsSection settings={settings} />
          <DataSection onImported={handleImported} />
          <AboutSection />
        </ScrollView>
      )}
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  content: { paddingBottom: 40, gap: 20 },
  centerFill: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 },
  errorText: { fontSize: 13 },
});
