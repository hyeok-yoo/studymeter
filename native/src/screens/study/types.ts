/**
 * types.ts — Study 타이머 관련 공용 타입.
 *
 * 내비게이션 파라미터(RootStack)와 AsyncStorage 진행중 세션 스냅샷 형태를 모은다.
 * StudyScreen 은 스택 화면으로 올라오고, HomeScreen 의 시작 시트가 파라미터를 넘긴다.
 */

/** Study 화면에 넘기는 시작 파라미터. */
export interface StudyParams {
  subject: string;
  subItem?: string;
  type: string;
  /** 테스트(카운트다운) 유형일 때만. 카운트다운 총 길이(ms). */
  countdownMs?: number;
}

/** 루트 스택 라우트 목록. Tabs(하단 탭 전체) + Study(몰입형 타이머). */
export type RootStackParamList = {
  Tabs: undefined;
  Study: StudyParams;
};

/**
 * 진행 중 세션 스냅샷 — AsyncStorage 에 저장/복원.
 * 절대 시각 기반이므로 앱이 죽어도 재실행 시 정확히 이어진다.
 */
export interface ActiveSession {
  subject: string;
  subItem?: string;
  type: string;
  isRunning: boolean;
  /** 세션 최초 시작 시각(epoch ms). */
  originalStartTime: number;
  /** 누적 일시정지 시간(ms). */
  totalPausedMs: number;
  /** 일시정지 시작 시각(epoch ms). null 이면 실행 중. */
  pausedAtTime: number | null;
  countdownMs?: number;
}
