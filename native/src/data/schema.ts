/**
 * schema.ts — SQLite 스키마 정의 + 순수 매핑 헬퍼.
 *
 * 웹앱 Dexie 스키마(src/lib/db.ts)를 SQLite 로 미러링한다.
 * - 마이그레이션은 `PRAGMA user_version` 로 버전 관리 (db.ts 의 러너가 적용).
 * - JSON 컬럼(evaluation, dayTags, stats, settings.data)은 TEXT 로 저장하고
 *   safeParse/serialize 로 감싼다. 파손 데이터는 fallback 으로 흡수한다.
 * - 날짜/시간은 웹과 동일: epoch ms(INTEGER) + 'YYYY-MM-DD'(TEXT).
 *
 * 이 파일은 sqlite 를 import 하지 않는다(순수). 바인딩 값 타입만 별칭으로 둔다.
 */

// ── 바인딩 값 타입 (expo-sqlite SQLiteBindValue 와 호환되는 최소 집합) ──────────
export type BindValue = string | number | null;

// ── 웹 인터페이스 미러 ────────────────────────────────────────────────────────

export interface SessionEvaluation {
  score?: number;
  tags?: string[];
  focus?: number;
  satisfaction?: number;
  problemSolving?: { correct: number; total: number };
  memo?: string;
}

/** 신/구 평가 데이터에서 통합 점수(1-10)를 얻는다. 없으면 null. 웹 getEvalScore 포팅. */
export function getEvalScore(e: SessionEvaluation | undefined): number | null {
  if (!e) return null;
  if (typeof e.score === 'number') return e.score;
  if (typeof e.focus === 'number' && typeof e.satisfaction === 'number') {
    return Math.round(((e.focus + e.satisfaction) / 2) * 10) / 10;
  }
  if (typeof e.focus === 'number') return e.focus;
  return null;
}

export interface StudySession {
  id?: number;
  date: string; // YYYY-MM-DD
  subject: string;
  subItem?: string;
  type: string;
  startTime: number; // ms
  endTime: number; // ms
  duration: number; // ms
  pausedMs?: number; // 세션 중 일시정지 누적(ms). 웹 레거시엔 없을 수 있음
  evaluation?: SessionEvaluation;
  drowsyCount?: number;
}

export interface DailyRecord {
  date: string; // YYYY-MM-DD (PK)
  wakeUpTime?: string;
  arrivalTime?: string;
  leaveTime?: string;
  bedTime?: string;
  firstVisitCompleted: boolean;
}

export interface SubjectItem {
  name: string;
  children?: string[];
}

export type AiRole = 'deep' | 'interactive' | 'ambient';
export type AiThinkingLevel = 'off' | 'low' | 'medium' | 'high';

export interface EvalTag {
  name: string;
  category: 'obstacle' | 'condition' | 'good' | 'context' | 'day';
  scope: 'session' | 'day' | 'both';
  hidden?: boolean;
  custom?: boolean;
}

export interface AiSystemPrompts {
  base?: string;
  chat?: string;
  morningReport?: string;
  diaryDraft?: string;
  diaryReply?: string;
  sessionComment?: string;
}

export interface Settings {
  id?: number;
  userName: string;
  subjects: SubjectItem[];
  types: string[];
  geminiApiKey?: string;
  geminiModel?: string;
  theme: 'light' | 'dark' | 'system';
  profilePicture?: string;
  isManualModel?: boolean;
  dailyGoalMs?: number;
  drowsinessThresholdSec?: number;
  advancedMode?: boolean;
  aiAmbientEnabled?: boolean;
  aiRoleModels?: Partial<Record<AiRole, string>>;
  aiThinkingLevels?: Partial<Record<AiRole, AiThinkingLevel>>;
  aiGroundingDefault?: boolean;
  aiSystemPrompts?: AiSystemPrompts;
  evalTags?: EvalTag[];
  morningReportHour?: number;
  morningReportEnabled?: boolean;
}

export interface DiaryStats {
  totalMs: number;
  selfStudyMs: number;
  goalPct: number | null;
  sessionCount: number;
  avgScore: number | null;
  drowsyCount: number;
  bySubject: Array<{ subject: string; ms: number }>;
}

export interface DiaryEntry {
  date: string; // YYYY-MM-DD (PK, 3am 기준)
  score: number;
  dayTags: string[];
  oneLiner?: string;
  oneLinerSource?: 'ai' | 'ai-edited' | 'user' | 'voice';
  aiReply?: string;
  auto: boolean;
  stats: DiaryStats;
  createdAt: number;
  updatedAt: number;
}

export interface AiArtifact {
  id?: number;
  kind: string;
  date: string;
  content: string;
  model: string;
  createdAt: number;
}

export interface ThoughtNote {
  id?: number;
  date: string;
  sessionStartTime: number;
  createdAt: number;
  content: string;
  reviewed: boolean;
}

// ── JSON 헬퍼 (파손 데이터 방어) ──────────────────────────────────────────────

/** TEXT 컬럼을 JSON 파싱. null/파손 시 fallback 반환. */
export function safeParse<T>(text: string | null | undefined, fallback: T): T {
  if (text == null) return fallback;
  try {
    const parsed = JSON.parse(text);
    return parsed == null ? fallback : (parsed as T);
  } catch {
    return fallback;
  }
}

/** 객체 → TEXT. undefined 는 null(빈 컬럼)로. */
export function serialize(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}

/** 불리언 → 0/1 (SQLite 는 boolean 바인딩 불가). */
export function boolToInt(v: boolean | undefined): number {
  return v ? 1 : 0;
}

// ── 마이그레이션 ──────────────────────────────────────────────────────────────

export const SCHEMA_VERSION = 1;

const MIGRATION_1 = /* sql */ `
CREATE TABLE IF NOT EXISTS sessions (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  date         TEXT    NOT NULL,
  subject      TEXT    NOT NULL,
  subItem      TEXT,
  type         TEXT    NOT NULL,
  startTime    INTEGER NOT NULL,
  endTime      INTEGER NOT NULL,
  duration     INTEGER NOT NULL,
  pausedMs     INTEGER,
  drowsyCount  INTEGER,
  evaluation   TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_date      ON sessions(date);
CREATE INDEX IF NOT EXISTS idx_sessions_startTime ON sessions(startTime);

CREATE TABLE IF NOT EXISTS dailyRecords (
  date                TEXT PRIMARY KEY,
  wakeUpTime          TEXT,
  arrivalTime         TEXT,
  leaveTime           TEXT,
  bedTime             TEXT,
  firstVisitCompleted INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS settings (
  id   INTEGER PRIMARY KEY CHECK (id = 1),
  data TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS diaryEntries (
  date           TEXT PRIMARY KEY,
  score          INTEGER NOT NULL,
  dayTags        TEXT,
  oneLiner       TEXT,
  oneLinerSource TEXT,
  aiReply        TEXT,
  auto           INTEGER NOT NULL DEFAULT 0,
  stats          TEXT,
  createdAt      INTEGER NOT NULL,
  updatedAt      INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS aiArtifacts (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  kind      TEXT    NOT NULL,
  date      TEXT    NOT NULL,
  content   TEXT    NOT NULL,
  model     TEXT    NOT NULL,
  createdAt INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_aiArtifacts_kind_date ON aiArtifacts(kind, date);

CREATE TABLE IF NOT EXISTS thoughtNotes (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  date             TEXT    NOT NULL,
  sessionStartTime INTEGER NOT NULL,
  createdAt        INTEGER NOT NULL,
  content          TEXT    NOT NULL,
  reviewed         INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_thoughtNotes_date      ON thoughtNotes(date);
CREATE INDEX IF NOT EXISTS idx_thoughtNotes_sessionStartTime ON thoughtNotes(sessionStartTime);
`;

/** version → 해당 버전으로 올리는 DDL. db.ts 의 러너가 user_version 순서대로 적용. */
export const MIGRATIONS: Record<number, string> = {
  1: MIGRATION_1,
};

// ── DB row ↔ 객체 매핑 (순수) ─────────────────────────────────────────────────

export interface SessionRow {
  id: number;
  date: string;
  subject: string;
  subItem: string | null;
  type: string;
  startTime: number;
  endTime: number;
  duration: number;
  pausedMs: number | null;
  drowsyCount: number | null;
  evaluation: string | null;
}

export function rowToSession(r: SessionRow): StudySession {
  const s: StudySession = {
    id: r.id,
    date: r.date,
    subject: r.subject,
    type: r.type,
    startTime: r.startTime,
    endTime: r.endTime,
    duration: r.duration,
  };
  if (r.subItem != null) s.subItem = r.subItem;
  if (r.pausedMs != null) s.pausedMs = r.pausedMs;
  if (r.drowsyCount != null) s.drowsyCount = r.drowsyCount;
  const evaluation = safeParse<SessionEvaluation | null>(r.evaluation, null);
  if (evaluation) s.evaluation = evaluation;
  return s;
}

export const SESSIONS_INSERT =
  `INSERT INTO sessions (date, subject, subItem, type, startTime, endTime, duration, pausedMs, drowsyCount, evaluation)` +
  ` VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

export function sessionToParams(s: StudySession): BindValue[] {
  return [
    s.date,
    s.subject,
    s.subItem ?? null,
    s.type,
    s.startTime,
    s.endTime,
    s.duration,
    s.pausedMs ?? null,
    s.drowsyCount ?? null,
    serialize(s.evaluation),
  ];
}

export interface DailyRecordRow {
  date: string;
  wakeUpTime: string | null;
  arrivalTime: string | null;
  leaveTime: string | null;
  bedTime: string | null;
  firstVisitCompleted: number;
}

export function rowToDailyRecord(r: DailyRecordRow): DailyRecord {
  const d: DailyRecord = { date: r.date, firstVisitCompleted: r.firstVisitCompleted === 1 };
  if (r.wakeUpTime != null) d.wakeUpTime = r.wakeUpTime;
  if (r.arrivalTime != null) d.arrivalTime = r.arrivalTime;
  if (r.leaveTime != null) d.leaveTime = r.leaveTime;
  if (r.bedTime != null) d.bedTime = r.bedTime;
  return d;
}

export const DAILY_RECORDS_INSERT =
  `INSERT OR REPLACE INTO dailyRecords (date, wakeUpTime, arrivalTime, leaveTime, bedTime, firstVisitCompleted)` +
  ` VALUES (?, ?, ?, ?, ?, ?)`;

export function dailyRecordToParams(d: DailyRecord): BindValue[] {
  return [
    d.date,
    d.wakeUpTime ?? null,
    d.arrivalTime ?? null,
    d.leaveTime ?? null,
    d.bedTime ?? null,
    boolToInt(d.firstVisitCompleted),
  ];
}

export interface DiaryRow {
  date: string;
  score: number;
  dayTags: string | null;
  oneLiner: string | null;
  oneLinerSource: string | null;
  aiReply: string | null;
  auto: number;
  stats: string | null;
  createdAt: number;
  updatedAt: number;
}

const EMPTY_STATS: DiaryStats = {
  totalMs: 0,
  selfStudyMs: 0,
  goalPct: null,
  sessionCount: 0,
  avgScore: null,
  drowsyCount: 0,
  bySubject: [],
};

export function rowToDiaryEntry(r: DiaryRow): DiaryEntry {
  const e: DiaryEntry = {
    date: r.date,
    score: r.score,
    dayTags: safeParse<string[]>(r.dayTags, []),
    auto: r.auto === 1,
    stats: safeParse<DiaryStats>(r.stats, { ...EMPTY_STATS }),
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
  if (r.oneLiner != null) e.oneLiner = r.oneLiner;
  if (r.oneLinerSource != null) e.oneLinerSource = r.oneLinerSource as DiaryEntry['oneLinerSource'];
  if (r.aiReply != null) e.aiReply = r.aiReply;
  return e;
}

export const DIARY_INSERT =
  `INSERT OR REPLACE INTO diaryEntries (date, score, dayTags, oneLiner, oneLinerSource, aiReply, auto, stats, createdAt, updatedAt)` +
  ` VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

export function diaryToParams(e: DiaryEntry): BindValue[] {
  return [
    e.date,
    e.score,
    serialize(e.dayTags ?? []),
    e.oneLiner ?? null,
    e.oneLinerSource ?? null,
    e.aiReply ?? null,
    boolToInt(e.auto),
    serialize(e.stats),
    e.createdAt,
    e.updatedAt,
  ];
}

export interface AiArtifactRow {
  id: number;
  kind: string;
  date: string;
  content: string;
  model: string;
  createdAt: number;
}

export function rowToAiArtifact(r: AiArtifactRow): AiArtifact {
  return {
    id: r.id,
    kind: r.kind,
    date: r.date,
    content: r.content,
    model: r.model,
    createdAt: r.createdAt,
  };
}

export interface ThoughtNoteRow {
  id: number;
  date: string;
  sessionStartTime: number;
  createdAt: number;
  content: string;
  reviewed: number;
}

export function rowToThoughtNote(r: ThoughtNoteRow): ThoughtNote {
  return {
    id: r.id,
    date: r.date,
    sessionStartTime: r.sessionStartTime,
    createdAt: r.createdAt,
    content: r.content,
    reviewed: r.reviewed === 1,
  };
}

export const THOUGHT_NOTES_INSERT =
  `INSERT INTO thoughtNotes (date, sessionStartTime, createdAt, content, reviewed) VALUES (?, ?, ?, ?, ?)`;

export function thoughtNoteToParams(t: ThoughtNote): BindValue[] {
  return [t.date, t.sessionStartTime, t.createdAt, t.content, boolToInt(t.reviewed)];
}
