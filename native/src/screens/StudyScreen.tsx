/**
 * StudyScreen — 다크 몰입형 공부 타이머 화면.
 *
 * 웹 src/pages/Study.tsx 의 핵심을 네이티브로 이식한다:
 *  - 절대 시각 기반 타이머(useStudyTimer) — 앱 종료/백그라운드에도 정확.
 *  - expo-keep-awake 로 실행 중 화면 유지.
 *  - expo-notifications 지속(sticky) 알림에 과목·경과(분) 표시, 1분 간격 갱신.
 *  - 종료 시 dao.saveSession 저장 → 세션 평가 시트(점수+태그) → 홈 복귀.
 *  - Android 뒤로가기/Exit 는 확인 후에만 종료(실수 종료 방지).
 *
 * 몰입감을 위해 이 화면은 테마와 무관하게 항상 다크 팔레트를 쓴다(웹 true-black 의도).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { usePreventRemove } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { DisplayText, PressableScale } from '../components';
import {
  saveSession,
  getTodayTotalStudyTime,
  getDateFromTimestamp,
  formatDuration,
  formatDurationHourMinute,
} from '../data/dao';
import { getDatabase } from '../data/db';
import { serialize, type SessionEvaluation } from '../data/schema';
import { useStudyTimer } from './study/useStudyTimer';
import { SessionEvalSheet } from './study/SessionEvalSheet';
import {
  presentOngoing,
  clearOngoing,
  requestNotificationPermission,
} from './study/notifications';
import type { RootStackParamList } from './study/types';

// 몰입형 다크 팔레트 (테마 무관 고정).
const DARK = {
  bg: '#04070f',
  text: '#f8fafc',
  textDim: '#94a3b8',
  primary: '#6366f1',
  countdown: '#ef4444',
  running: '#facc15',
  paused: '#22c55e',
  chip: 'rgba(255,255,255,0.08)',
  chipBorder: 'rgba(255,255,255,0.12)',
};

const KEEP_AWAKE_TAG = 'study-session';

type Props = NativeStackScreenProps<RootStackParamList, 'Study'>;

export function StudyScreen({ navigation, route }: Props) {
  const timer = useStudyTimer(route.params);
  const {
    loaded,
    subject,
    subItem,
    type,
    countdownMs,
    isRunning,
    elapsedMs,
    togglePause,
    getSnapshot,
  } = timer;

  const [todayTotalMs, setTodayTotalMs] = useState(0);
  const [isEnding, setIsEnding] = useState(false);
  const [showEval, setShowEval] = useState(false);
  const [lastId, setLastId] = useState<number | null>(null);
  const [lastDuration, setLastDuration] = useState(0);
  const [testDone, setTestDone] = useState(false);
  const endingRef = useRef(false);

  const isTest = countdownMs != null;
  const remainingMs = isTest ? Math.max(0, countdownMs - elapsedMs) : 0;

  // 오늘 총 공부시간(이전 세션들) 로드.
  useEffect(() => {
    if (!loaded) return;
    let cancelled = false;
    void getTodayTotalStudyTime().then((ms) => {
      if (!cancelled) setTodayTotalMs(ms);
    });
    return () => {
      cancelled = true;
    };
  }, [loaded]);

  // 화면 유지: 실행 중일 때만.
  useEffect(() => {
    if (isRunning) {
      void activateKeepAwakeAsync(KEEP_AWAKE_TAG);
    } else {
      deactivateKeepAwake(KEEP_AWAKE_TAG).catch(() => {});
    }
    return () => {
      deactivateKeepAwake(KEEP_AWAKE_TAG).catch(() => {});
    };
  }, [isRunning]);

  // 알림 권한 1회 요청.
  useEffect(() => {
    if (loaded) void requestNotificationPermission();
  }, [loaded]);

  const present = useCallback(() => {
    void presentOngoing({
      subject,
      subItem,
      type,
      elapsedMs: getSnapshot().duration,
      isRunning,
      color: DARK.primary,
    });
  }, [subject, subItem, type, isRunning, getSnapshot]);

  // 지속 알림: 시작/일시정지/재개/과목 변경 시 갱신.
  useEffect(() => {
    if (!loaded || isEnding) return;
    present();
  }, [loaded, isEnding, present]);

  // 지속 알림: 실행 중 1분 간격 갱신(과도한 갱신 금지).
  useEffect(() => {
    if (!loaded || isEnding || !isRunning) return;
    const id = setInterval(present, 60000);
    return () => clearInterval(id);
  }, [loaded, isEnding, isRunning, present]);

  // 화면 이탈 시 알림/화면유지 정리(예외 경로 방어).
  useEffect(() => {
    return () => {
      void clearOngoing();
      deactivateKeepAwake(KEEP_AWAKE_TAG).catch(() => {});
    };
  }, []);

  // 테스트 카운트다운 종료 감지.
  useEffect(() => {
    if (isTest && !testDone && countdownMs != null && elapsedMs >= countdownMs) {
      setTestDone(true);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
  }, [isTest, testDone, countdownMs, elapsedMs]);

  const handleEnd = useCallback(async () => {
    if (endingRef.current) return;
    endingRef.current = true;
    setIsEnding(true);
    await clearOngoing();
    deactivateKeepAwake(KEEP_AWAKE_TAG).catch(() => {});

    const snap = getSnapshot();
    // 1초 미만은 저장하지 않고 즉시 이탈.
    if (snap.duration < 1000) {
      await timer.clear();
      navigation.goBack();
      return;
    }

    try {
      const id = await saveSession({
        date: getDateFromTimestamp(snap.startTime),
        subject,
        subItem,
        type,
        startTime: snap.startTime,
        endTime: snap.endTime,
        duration: snap.duration,
        pausedMs: snap.pausedMs,
      });
      await timer.clear();
      setLastId(id);
      setLastDuration(snap.duration);
      setShowEval(true);
    } catch {
      await timer.clear();
      navigation.goBack();
    }
  }, [getSnapshot, subject, subItem, type, timer, navigation]);

  const confirmEnd = useCallback(() => {
    if (endingRef.current) return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    Alert.alert('세션을 종료할까요?', '지금까지의 공부 기록이 저장돼요.', [
      { text: '취소', style: 'cancel' },
      { text: '종료', style: 'destructive', onPress: () => void handleEnd() },
    ]);
  }, [handleEnd]);

  // Android 뒤로가기 / 스와이프 back 방지 — 확인 후에만 종료.
  usePreventRemove(!isEnding, () => {
    confirmEnd();
  });

  const onEvalSave = useCallback(
    async (evaluation: SessionEvaluation) => {
      if (lastId != null) {
        try {
          const db = await getDatabase();
          await db.runAsync(
            'UPDATE sessions SET evaluation = ? WHERE id = ?',
            serialize(evaluation),
            lastId
          );
        } catch {
          /* 평가 저장 실패는 무시 — 세션 기록 자체는 이미 저장됨 */
        }
      }
      setShowEval(false);
      navigation.goBack();
    },
    [lastId, navigation]
  );

  const onEvalSkip = useCallback(() => {
    setShowEval(false);
    navigation.goBack();
  }, [navigation]);

  // 표시할 큰 숫자.
  const bigLabel = isTest ? formatDuration(remainingMs) : formatDuration(elapsedMs);
  const bigColor = isTest ? DARK.countdown : DARK.text;
  const dotColor = isRunning ? DARK.countdown : DARK.running;

  return (
    <SafeAreaView edges={['top', 'bottom', 'left', 'right']} style={styles.root}>
      {/* 상단바 */}
      <Animated.View entering={FadeIn} style={styles.topBar}>
        <View style={styles.statusPill}>
          <View style={[styles.liveDot, { backgroundColor: dotColor }]} />
          <Text style={styles.statusText}>{isRunning ? 'FOCUSING NOW' : 'PAUSED'}</Text>
        </View>
        <PressableScale onPress={confirmEnd} accessibilityLabel="세션 종료">
          <View style={styles.exitBtn}>
            <Text style={styles.exitText}>종료</Text>
          </View>
        </PressableScale>
      </Animated.View>

      {/* 중앙 타이머 */}
      <View style={styles.center}>
        <Text style={styles.subjectLabel}>
          {subItem ? `${subject} › ${subItem}` : subject} · {type}
        </Text>

        <Animated.View entering={FadeInDown.springify()} style={{ opacity: isRunning ? 1 : 0.55 }}>
          <DisplayText size={68} color={bigColor} style={styles.timerText}>
            {bigLabel}
          </DisplayText>
        </Animated.View>

        <Text style={styles.totalLabel}>
          오늘 총 {formatDurationHourMinute(todayTotalMs + elapsedMs)}
        </Text>

        {isTest ? (
          <Text style={styles.testHint}>
            {testDone ? '테스트 종료! 수고했어요.' : '남은 시간'}
          </Text>
        ) : null}
      </View>

      {/* 컨트롤 */}
      <View style={styles.controls}>
        <PressableScale
          strength="strong"
          onPress={togglePause}
          accessibilityLabel={isRunning ? '일시정지' : '재개'}
        >
          <View
            style={[
              styles.playBtn,
              { backgroundColor: isRunning ? DARK.running : DARK.paused },
            ]}
          >
            {isRunning ? (
              <View style={styles.pauseIcon}>
                <View style={styles.pauseBar} />
                <View style={styles.pauseBar} />
              </View>
            ) : (
              <View style={styles.playIcon} />
            )}
          </View>
        </PressableScale>
      </View>

      <SessionEvalSheet
        visible={showEval}
        subject={subject}
        subItem={subItem}
        durationMs={lastDuration}
        onSave={onEvalSave}
        onSkip={onEvalSkip}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: DARK.bg, justifyContent: 'space-between' },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 8,
  },
  statusPill: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  liveDot: { width: 8, height: 8, borderRadius: 999 },
  statusText: {
    color: DARK.textDim,
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 2,
  },
  exitBtn: {
    paddingHorizontal: 18,
    paddingVertical: 9,
    borderRadius: 999,
    backgroundColor: DARK.chip,
  },
  exitText: { color: DARK.text, fontSize: 13, fontWeight: '700' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14 },
  subjectLabel: {
    color: DARK.textDim,
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: 3,
    textTransform: 'uppercase',
    textAlign: 'center',
    paddingHorizontal: 24,
  },
  timerText: { textAlign: 'center' },
  totalLabel: { color: DARK.textDim, fontSize: 14, fontWeight: '700' },
  testHint: { color: DARK.countdown, fontSize: 13, fontWeight: '700', marginTop: 2 },
  controls: { alignItems: 'center', paddingBottom: 40 },
  playBtn: {
    width: 104,
    height: 104,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pauseIcon: { flexDirection: 'row', gap: 8 },
  pauseBar: { width: 11, height: 38, borderRadius: 3, backgroundColor: '#000' },
  playIcon: {
    width: 0,
    height: 0,
    marginLeft: 8,
    borderLeftWidth: 30,
    borderLeftColor: '#fff',
    borderTopWidth: 19,
    borderTopColor: 'transparent',
    borderBottomWidth: 19,
    borderBottomColor: 'transparent',
  },
});
