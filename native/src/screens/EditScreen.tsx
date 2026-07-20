/**
 * EditScreen — 기록 편집 화면. 웹 src/pages/EditRecords.tsx 의 정보 구조를 네이티브로 이식.
 *
 * 날짜 네비(◀ 날짜 ▶) + 그날 세션 리스트(과목·유형·시작~끝·시간) + 세션 삭제
 * (확인 Alert) + 수동 세션 추가/수정(edit/SessionForm.tsx). 세션 update/delete 는
 * dao.ts 에 없고, dao.ts 는 다른 에이전트와 충돌 위험이 있어 수정하지 않는다 —
 * 대신 edit/sessionHelpers.ts 의 로컬 SQL 헬퍼(data/db.ts 의 getDb 사용)로 처리한다.
 *
 * 규칙: 색은 useTheme() 토큰, 날짜는 dao 헬퍼(toISOString 금지), 등장은 FadeInDown.springify.
 */
import { useCallback, useMemo, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import * as Haptics from 'expo-haptics';
import { SafeAreaView } from 'react-native-safe-area-context';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { GlassCard } from '../components/GlassCard';
import { PressableScale } from '../components/PressableScale';
import { useTheme } from '../theme/ThemeProvider';
import { initDatabase } from '../data/db';
import { formatDateYYYYMMDD, getSessionsByDate, getSettings, getStudyToday } from '../data/dao';
import type { Settings, StudySession } from '../data/schema';
import { DEFAULT_SETTINGS } from './settings/defaultSettings';
import { deleteSession } from './edit/sessionHelpers';
import { SessionForm } from './edit/SessionForm';
import { SessionListItem } from './edit/SessionListItem';

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

function formatDateKorean(d: Date): string {
  return `${d.getMonth() + 1}월 ${d.getDate()}일 (${WEEKDAYS[d.getDay()]})`;
}

export function EditScreen() {
  const theme = useTheme();
  const [dayOffset, setDayOffset] = useState(0); // 0 = 오늘, 음수 = 과거
  const [sessions, setSessions] = useState<StudySession[]>([]);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [editing, setEditing] = useState<StudySession | null>(null);

  const targetDate = useMemo(() => {
    const d = getStudyToday();
    d.setDate(d.getDate() + dayOffset);
    return d;
  }, [dayOffset]);
  const dateStr = useMemo(() => formatDateYYYYMMDD(targetDate), [targetDate]);

  const load = useCallback(async () => {
    await initDatabase();
    const [list, s] = await Promise.all([getSessionsByDate(dateStr), getSettings()]);
    setSessions([...list].sort((a, b) => b.startTime - a.startTime));
    setSettings(s ?? DEFAULT_SETTINGS);
  }, [dateStr]);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      (async () => {
        try {
          await load();
        } catch {
          if (!cancelled) setSessions([]);
        }
      })();
      return () => {
        cancelled = true;
      };
    }, [load])
  );

  const goPrev = () => {
    void Haptics.selectionAsync();
    setEditing(null);
    setDayOffset((o) => o - 1);
  };
  const goNext = () => {
    if (dayOffset >= 0) return;
    void Haptics.selectionAsync();
    setEditing(null);
    setDayOffset((o) => Math.min(o + 1, 0));
  };

  const handleDelete = (session: StudySession) => {
    if (!session.id) return;
    Alert.alert('기록 삭제', '이 학습 기록을 삭제할까요? 되돌릴 수 없습니다.', [
      { text: '취소', style: 'cancel' },
      {
        text: '삭제',
        style: 'destructive',
        onPress: async () => {
          await deleteSession(session.id!);
          if (editing?.id === session.id) setEditing(null);
          void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          load();
        },
      },
    ]);
  };

  return (
    <SafeAreaView
      edges={['top', 'left', 'right']}
      style={[styles.root, { backgroundColor: theme.colors.bg }]}
    >
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={[styles.title, { color: theme.colors.text }]}>기록 편집</Text>

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

        <Animated.View entering={FadeInDown.springify()} style={styles.section}>
          <SessionForm
            settings={settings}
            date={dateStr}
            editing={editing}
            onCancelEdit={() => setEditing(null)}
            onSaved={() => {
              setEditing(null);
              load();
            }}
          />
        </Animated.View>

        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: theme.colors.textSecondary }]}>
            {formatDateKorean(targetDate)} 세션 ({sessions.length})
          </Text>
          <View style={styles.list}>
            {sessions.length > 0 ? (
              sessions.map((s, i) => (
                <SessionListItem
                  key={s.id ?? i}
                  session={s}
                  active={!!editing && editing.id === s.id}
                  delay={Math.min(i, 6) * 40}
                  onPress={() => setEditing(s)}
                  onDelete={() => handleDelete(s)}
                />
              ))
            ) : (
              <GlassCard style={styles.empty} radius={theme.radius.lg}>
                <Text style={[styles.emptyText, { color: theme.colors.textSecondary }]}>
                  이 날의 공부 기록이 없어요.
                </Text>
              </GlassCard>
            )}
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 32, gap: 20 },
  title: { fontSize: 30, fontWeight: '800', letterSpacing: -0.5 },
  dateNav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  navBtn: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  navGlyph: { fontSize: 26, fontWeight: '700', lineHeight: 30 },
  dateLabel: { fontSize: 17, fontWeight: '800', fontVariant: ['tabular-nums'] },
  section: { gap: 12 },
  sectionTitle: { fontSize: 12, fontWeight: '700', letterSpacing: 0.4 },
  list: { gap: 10 },
  empty: { alignItems: 'center', paddingVertical: 36 },
  emptyText: { fontSize: 14, fontWeight: '500', fontStyle: 'italic' },
});
