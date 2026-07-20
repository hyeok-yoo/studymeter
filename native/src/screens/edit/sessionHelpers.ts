/**
 * sessionHelpers.ts — 세션 수정/삭제 + 겹침 처리 로컬 SQL 헬퍼.
 *
 * dao.ts 에는 세션 update/delete/겹침 처리 함수가 없다. dao.ts 는 다른 에이전트와
 * 충돌 위험이 있어 수정하지 않기로 했으므로, 여기서 data/db.ts 의 getDb() 를 직접
 * 써서 로컬로 구현한다. EditScreen 이 화면 진입 시 initDatabase() 를 먼저 호출해
 * 초기화를 보장하므로, 여기서는 이미 열려 있는 핸들만 재사용하는 getDb() 를 쓴다.
 */
import { getDb } from '../../data/db';
import { rowToSession, sessionToParams, type SessionRow, type StudySession } from '../../data/schema';

/** 세션 전체 필드 갱신(id 고정, 나머지는 SESSIONS_INSERT 와 동일 컬럼 순서). 웹 updateStudySession 포팅. */
export async function updateSession(id: number, session: StudySession): Promise<void> {
  const db = getDb();
  const params = sessionToParams(session);
  await db.runAsync(
    `UPDATE sessions SET date = ?, subject = ?, subItem = ?, type = ?, startTime = ?, endTime = ?, duration = ?, pausedMs = ?, drowsyCount = ?, evaluation = ? WHERE id = ?`,
    [...params, id]
  );
}

/** 세션 삭제. 웹 deleteStudySession 포팅. */
export async function deleteSession(id: number): Promise<void> {
  const db = getDb();
  await db.runAsync('DELETE FROM sessions WHERE id = ?', id);
}

/** 특정 시간 범위와 겹치는 세션 탐색(수정 시 자기 자신 제외). 웹 findOverlappingSession 포팅. */
export async function findOverlappingSession(
  date: string,
  startTime: number,
  endTime: number,
  excludeId?: number
): Promise<StudySession | null> {
  const db = getDb();
  const rows = await db.getAllAsync<SessionRow>('SELECT * FROM sessions WHERE date = ?', date);
  const found = rows.find((r) => r.id !== excludeId && r.startTime < endTime && r.endTime > startTime);
  return found ? rowToSession(found) : null;
}

/** 겹치는 세션의 종료 시간을 새 세션 시작 직전으로 당긴다. 웹 adjustOverlappingSession 포팅. */
export async function adjustOverlappingSessionEnd(sessionId: number, newEndTime: number): Promise<void> {
  const db = getDb();
  const row = await db.getFirstAsync<SessionRow>('SELECT * FROM sessions WHERE id = ?', sessionId);
  if (!row) return;
  const newDuration = newEndTime - row.startTime;
  await db.runAsync('UPDATE sessions SET endTime = ?, duration = ? WHERE id = ?', [
    newEndTime,
    newDuration,
    sessionId,
  ]);
}
