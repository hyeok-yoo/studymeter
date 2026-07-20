/**
 * dao.ts — 데이터 접근 계층. 웹앱 src/lib/db.ts 의 함수들을 같은 이름/시그니처로 포팅한다.
 *
 * 웹과 달라진 부분:
 *  - saveSession / getSettings / saveSettings 는 웹 db.ts 에 없던 신규 함수
 *    (웹은 db.sessions.add / initializeSettings 를 직접 사용). 아래 주석 참고.
 *  - 나머지는 반환 타입/시그니처를 웹과 동일하게 맞췄다.
 *
 * 날짜 헬퍼(getTodayDate 등)는 datetime.ts 에서 re-export 하여 웹처럼 이 모듈에서도 쓸 수 있다.
 */
import { getDatabase } from './db';
import {
  getTodayDate,
  formatDateYYYYMMDD,
} from './datetime';
import {
  SESSIONS_INSERT,
  sessionToParams,
  rowToSession,
  DIARY_INSERT,
  diaryToParams,
  rowToDiaryEntry,
  rowToAiArtifact,
  serialize,
  safeParse,
  type StudySession,
  type SessionRow,
  type DiaryEntry,
  type DiaryRow,
  type AiArtifact,
  type AiArtifactRow,
  type Settings,
} from './schema';

// 웹처럼 dao 에서도 날짜 헬퍼를 노출한다.
export {
  getTodayDate,
  getStudyToday,
  getDateFromTimestamp,
  formatDateYYYYMMDD,
  formatTimeHHMM,
  formatDuration,
  formatDurationHourMinute,
} from './datetime';

// ── 세션 ──────────────────────────────────────────────────────────────────────

/**
 * 세션 저장. **웹에 없던 신규 함수** (웹은 db.sessions.add 직접 호출).
 * @returns 새로 삽입된 세션 id
 */
export async function saveSession(session: Omit<StudySession, 'id'>): Promise<number> {
  const db = await getDatabase();
  const result = await db.runAsync(SESSIONS_INSERT, sessionToParams(session));
  return result.lastInsertRowId;
}

/** 오늘 총 공부 시간(ms). 웹 getTodayTotalStudyTime 포팅. 비어 있으면 0. */
export async function getTodayTotalStudyTime(): Promise<number> {
  const db = await getDatabase();
  const today = getTodayDate();
  const row = await db.getFirstAsync<{ total: number | null }>(
    'SELECT SUM(duration) AS total FROM sessions WHERE date = ?',
    today
  );
  return row?.total ?? 0;
}

/** 오늘 과목별 공부 시간. 웹 getTodayStudyTimeBySubject 포팅 (자습/테스트 = selfStudy). */
export async function getTodayStudyTimeBySubject(): Promise<
  Map<string, { total: number; selfStudy: number }>
> {
  const db = await getDatabase();
  const today = getTodayDate();
  const rows = await db.getAllAsync<SessionRow>('SELECT * FROM sessions WHERE date = ?', today);

  const result = new Map<string, { total: number; selfStudy: number }>();
  for (const r of rows) {
    const session = rowToSession(r);
    const existing = result.get(session.subject) || { total: 0, selfStudy: 0 };
    existing.total += session.duration;
    if (session.type === '자습' || session.type === '테스트') {
      existing.selfStudy += session.duration;
    }
    result.set(session.subject, existing);
  }
  return result;
}

/** 특정 날짜의 세션 목록 (startTime 오름차순). */
export async function getSessionsByDate(date: string): Promise<StudySession[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<SessionRow>(
    'SELECT * FROM sessions WHERE date = ? ORDER BY startTime ASC',
    date
  );
  return rows.map(rowToSession);
}

// ── 일기 ──────────────────────────────────────────────────────────────────────

/** 날짜별 일기 조회. 웹 getDiaryEntry 포팅. */
export async function getDiaryEntry(date: string): Promise<DiaryEntry | undefined> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<DiaryRow>('SELECT * FROM diaryEntries WHERE date = ?', date);
  return row ? rowToDiaryEntry(row) : undefined;
}

/** 일기 저장(upsert). 웹 saveDiaryEntry(put) 포팅. */
export async function saveDiaryEntry(entry: DiaryEntry): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(DIARY_INSERT, diaryToParams(entry));
}

/** 날짜 범위 [start, end] 포함 일기 목록. 웹 getDiaryRange 포팅. */
export async function getDiaryRange(startDate: string, endDate: string): Promise<DiaryEntry[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<DiaryRow>(
    'SELECT * FROM diaryEntries WHERE date >= ? AND date <= ? ORDER BY date ASC',
    startDate,
    endDate
  );
  return rows.map(rowToDiaryEntry);
}

/**
 * 일기 연속 작성일(스트릭). 직접 확정(auto=false)한 일기만 센다.
 * 오늘 미작성이면 어제까지의 연속을 반환. 웹 getDiaryStreak 포팅.
 */
export async function getDiaryStreak(today: string): Promise<number> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<{ date: string; auto: number }>(
    'SELECT date, auto FROM diaryEntries WHERE date <= ?',
    today
  );
  const written = new Set(rows.filter((e) => e.auto !== 1).map((e) => e.date));
  let streak = 0;
  const cursor = new Date(today + 'T12:00:00');
  if (!written.has(today)) cursor.setDate(cursor.getDate() - 1);
  for (;;) {
    const dateStr = formatDateYYYYMMDD(cursor);
    if (!written.has(dateStr)) break;
    streak++;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

// ── AI 생성물 캐시 ────────────────────────────────────────────────────────────

/** kind+date 로 캐시 조회. 웹 getAiArtifact 포팅. */
export async function getAiArtifact(kind: string, date: string): Promise<AiArtifact | undefined> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<AiArtifactRow>(
    'SELECT * FROM aiArtifacts WHERE kind = ? AND date = ?',
    kind,
    date
  );
  return row ? rowToAiArtifact(row) : undefined;
}

/** 캐시 upsert. 웹 putAiArtifact 포팅 (kind+date UNIQUE 기준 교체). */
export async function putAiArtifact(artifact: Omit<AiArtifact, 'id'>): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    'INSERT INTO aiArtifacts (kind, date, content, model, createdAt) VALUES (?, ?, ?, ?, ?)' +
      ' ON CONFLICT(kind, date) DO UPDATE SET content = excluded.content, model = excluded.model, createdAt = excluded.createdAt',
    [artifact.kind, artifact.date, artifact.content, artifact.model, artifact.createdAt]
  );
}

/** 캐시 삭제. 웹 deleteAiArtifact 포팅. */
export async function deleteAiArtifact(kind: string, date: string): Promise<void> {
  const db = await getDatabase();
  await db.runAsync('DELETE FROM aiArtifacts WHERE kind = ? AND date = ?', kind, date);
}

// ── 설정 (단일 행 JSON) ───────────────────────────────────────────────────────

/**
 * 설정 조회. **웹에 없던 신규 함수** (웹은 initializeSettings 로 기본값까지 생성).
 * 저장된 설정이 없으면 undefined.
 */
export async function getSettings(): Promise<Settings | undefined> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<{ data: string }>('SELECT data FROM settings WHERE id = 1');
  if (!row) return undefined;
  const parsed = safeParse<Settings | null>(row.data, null);
  return parsed ?? undefined;
}

/**
 * 설정 저장(단일 행 upsert). **웹에 없던 신규 함수**.
 * 전체 Settings 객체를 JSON 으로 id=1 행에 저장한다.
 */
export async function saveSettings(settings: Settings): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    'INSERT OR REPLACE INTO settings (id, data) VALUES (1, ?)',
    serialize({ ...settings, id: 1 }) ?? '{}'
  );
}
