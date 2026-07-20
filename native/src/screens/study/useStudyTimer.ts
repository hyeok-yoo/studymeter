/**
 * useStudyTimer — 절대 시각 기반 공부 타이머 코어.
 *
 * 웹 Study.tsx 의 타이머 로직(절대 시각 + 누적 일시정지)을 RN 훅으로 포팅한다.
 * 핵심 규칙:
 *  - 경과는 항상 Date.now() - originalStartTime - totalPausedMs 로 계산한다.
 *    화면 틱(interval)은 표시 갱신용일 뿐, 계산의 근거가 아니다.
 *  - 일시정지 중에는 pausedAtTime 시점까지로 고정.
 *  - AppState 가 background→active 로 돌아오면 즉시 재계산해 정확한 경과를 보인다.
 *  - 진행 상태를 AsyncStorage 에 저장/복원해 앱이 죽어도 이어진다(persist.ts).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { loadActiveSession, saveActiveSession, clearActiveSession } from './persist';
import type { ActiveSession, StudyParams } from './types';

export interface TimerSnapshot {
  /** 세션 시작 시각(epoch ms) — 날짜 무결성 기준. */
  startTime: number;
  /** 종료 시각(epoch ms) — 일시정지 상태면 정지 시각, 아니면 지금. */
  endTime: number;
  /** 실제 공부 시간(ms). */
  duration: number;
  /** 누적 일시정지(ms). */
  pausedMs: number;
}

export interface UseStudyTimer {
  loaded: boolean;
  subject: string;
  subItem?: string;
  type: string;
  countdownMs?: number;
  isRunning: boolean;
  /** 현재 세션 경과(ms). */
  elapsedMs: number;
  /** 일시정지 ↔ 재개 토글. */
  togglePause: () => void;
  /** 저장/종료용 스냅샷을 즉시 계산해 반환. */
  getSnapshot: () => TimerSnapshot;
  /** AsyncStorage 진행중 세션 제거(종료 시 호출). */
  clear: () => Promise<void>;
}

export function useStudyTimer(params: StudyParams): UseStudyTimer {
  const originalStartTimeRef = useRef<number>(Date.now());
  const totalPausedMsRef = useRef<number>(0);
  const pausedAtTimeRef = useRef<number | null>(null);

  const [loaded, setLoaded] = useState(false);
  const [subject, setSubject] = useState(params.subject);
  const [subItem, setSubItem] = useState<string | undefined>(params.subItem);
  const [type, setType] = useState(params.type);
  const [countdownMs, setCountdownMs] = useState<number | undefined>(params.countdownMs);
  const [isRunning, setIsRunning] = useState(true);
  const [elapsedMs, setElapsedMs] = useState(0);

  // 현재 경과 계산(절대 시각 기반). ref 만 읽으므로 항상 최신.
  const computeElapsed = useCallback(() => {
    const anchor = pausedAtTimeRef.current ?? Date.now();
    return anchor - originalStartTimeRef.current - totalPausedMsRef.current;
  }, []);

  const buildSnapshot = useCallback(
    (running: boolean): ActiveSession => ({
      subject,
      subItem,
      type,
      isRunning: running,
      originalStartTime: originalStartTimeRef.current,
      totalPausedMs: totalPausedMsRef.current,
      pausedAtTime: pausedAtTimeRef.current,
      countdownMs,
    }),
    [subject, subItem, type, countdownMs]
  );

  // 마운트: 저장된 세션 복원 or 새 세션 시작.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const saved = await loadActiveSession();
      if (cancelled) return;
      if (saved) {
        originalStartTimeRef.current = saved.originalStartTime;
        totalPausedMsRef.current = saved.totalPausedMs || 0;
        pausedAtTimeRef.current = saved.isRunning ? null : saved.pausedAtTime ?? Date.now();
        setSubject(saved.subject);
        setSubItem(saved.subItem);
        setType(saved.type);
        setCountdownMs(saved.countdownMs);
        setIsRunning(saved.isRunning);
      } else {
        originalStartTimeRef.current = Date.now();
        totalPausedMsRef.current = 0;
        pausedAtTimeRef.current = null;
        setIsRunning(true);
        await saveActiveSession(buildSnapshot(true));
      }
      setElapsedMs(computeElapsed());
      setLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
    // 마운트 시 1회만.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 표시용 틱: 실행 중일 때만 250ms 마다 경과 갱신.
  useEffect(() => {
    if (!loaded || !isRunning) return;
    const id = setInterval(() => {
      setElapsedMs(computeElapsed());
    }, 250);
    return () => clearInterval(id);
  }, [loaded, isRunning, computeElapsed]);

  // AppState: 포그라운드 복귀 시 즉시 재계산(백그라운드 동안 정지했던 틱 보정).
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') setElapsedMs(computeElapsed());
    });
    return () => sub.remove();
  }, [computeElapsed]);

  const togglePause = useCallback(() => {
    let nextRunning: boolean;
    if (pausedAtTimeRef.current === null) {
      // 실행 중 → 일시정지
      pausedAtTimeRef.current = Date.now();
      nextRunning = false;
    } else {
      // 일시정지 → 재개
      totalPausedMsRef.current += Date.now() - pausedAtTimeRef.current;
      pausedAtTimeRef.current = null;
      nextRunning = true;
    }
    setIsRunning(nextRunning);
    setElapsedMs(computeElapsed());
    void saveActiveSession(buildSnapshot(nextRunning));
  }, [computeElapsed, buildSnapshot]);

  const getSnapshot = useCallback((): TimerSnapshot => {
    const start = originalStartTimeRef.current;
    const endTime = pausedAtTimeRef.current ?? Date.now();
    const duration = endTime - start - totalPausedMsRef.current;
    return { startTime: start, endTime, duration, pausedMs: totalPausedMsRef.current };
  }, []);

  const clear = useCallback(() => clearActiveSession(), []);

  return {
    loaded,
    subject,
    subItem,
    type,
    countdownMs,
    isRunning,
    elapsedMs,
    togglePause,
    getSnapshot,
    clear,
  };
}
