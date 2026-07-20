/**
 * datetime.ts — 순수 날짜/시간 헬퍼 (SQLite 의존성 없음).
 *
 * 웹앱(src/lib/db.ts)의 구현을 그대로 포팅한다.
 * 핵심 규칙:
 *  - 하루 경계는 "새벽 3시". 0~2시는 전날로 처리한다.
 *  - 로컬 날짜 문자열은 반드시 getFullYear/getMonth/getDate 로 만든다.
 *    toISOString() 은 UTC 라 로컬과 하루 어긋날 수 있어 금지.
 *
 * sqlite 를 import 하지 않으므로 `node --experimental-strip-types` 로 단독 스모크 테스트 가능.
 */

/** 새벽 3시 기준으로 날짜 조정 (0~2시는 전날로 처리). 웹 adjustForStudyDay 포팅. */
export function adjustForStudyDay(date: Date): Date {
  const adjusted = new Date(date);
  if (adjusted.getHours() < 3) {
    adjusted.setDate(adjusted.getDate() - 1);
  }
  return adjusted;
}

/** Date → 'YYYY-MM-DD' (로컬 시간 기준). 웹 formatDateYYYYMMDD 포팅. */
export function formatDateYYYYMMDD(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** 오늘 날짜 'YYYY-MM-DD' — 새벽 3시 기준. 웹 getTodayDate 포팅. */
export function getTodayDate(): string {
  return formatDateYYYYMMDD(adjustForStudyDay(new Date()));
}

/** 오늘 기준 Date (자정으로 정규화) — 새벽 3시 기준. 웹 getStudyToday 포팅. */
export function getStudyToday(): Date {
  const d = adjustForStudyDay(new Date());
  d.setHours(0, 0, 0, 0);
  return d;
}

/** timestamp(ms) → 'YYYY-MM-DD' — 새벽 3시 기준. 웹 getDateFromTimestamp 포팅. */
export function getDateFromTimestamp(timestamp: number): string {
  return formatDateYYYYMMDD(adjustForStudyDay(new Date(timestamp)));
}

/** timestamp(ms) → 'HH:mm' (로컬). 웹 formatTimeHHMM 포팅. */
export function formatTimeHHMM(timestamp: number): string {
  const date = new Date(timestamp);
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}

/** ms → 'HH:MM:SS'. 웹 formatDuration 포팅. */
export function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds
    .toString()
    .padStart(2, '0')}`;
}

/** ms → 'Xh Ym' (초 반올림). 웹 formatDurationHourMinute 포팅. HomeScreen 히어로 숫자용. */
export function formatDurationHourMinute(ms: number): string {
  const totalSeconds = Math.round(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
}
