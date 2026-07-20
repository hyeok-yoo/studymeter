/**
 * persist.ts — 진행 중 세션의 AsyncStorage 저장/복원.
 *
 * 웹 Study.tsx 의 localStorage('studymeter_active_session') 로직을 RN 으로 포팅.
 * 절대 시각(originalStartTime)과 누적 일시정지(totalPausedMs), 일시정지 시점
 * (pausedAtTime)만 저장하면 앱이 죽어도 Date.now() 기준으로 정확히 복원된다.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ActiveSession } from './types';

const STORAGE_KEY = 'studymeter_active_session';

/** 저장된 진행중 세션을 읽는다. 없거나 파손이면 null. */
export async function loadActiveSession(): Promise<ActiveSession | null> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ActiveSession;
    if (typeof parsed?.originalStartTime !== 'number') return null;
    return parsed;
  } catch {
    return null;
  }
}

/** 진행중 세션 스냅샷을 저장(덮어쓰기)한다. */
export async function saveActiveSession(session: ActiveSession): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  } catch {
    /* 저장 실패는 무시 — 복원 불가일 뿐 진행에는 지장 없음 */
  }
}

/** 진행중 세션을 제거한다(종료 시). */
export async function clearActiveSession(): Promise<void> {
  try {
    await AsyncStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}
