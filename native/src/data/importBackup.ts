/**
 * importBackup.ts — 웹앱 백업 JSON 임포트.
 *
 * 웹 src/lib/backup.ts 의 BackupFile(format 'studymeter-backup') 을 파싱하여
 * 전 테이블을 복원한다. 웹 importBackup 과 동일하게 **전체 교체**(각 테이블 clear 후
 * 재삽입)를 하나의 트랜잭션으로 수행한다.
 *   - v2: diaryEntries 포함
 *   - v1: diaryEntries 없음 → 빈 배열로 호환
 *
 * expo-document-picker 미설치이므로 파일 선택 UI 는 만들지 않고 JSON 문자열을 받는다.
 * parseBackup() 은 sqlite 의존성이 없는 순수 함수라 단독 스모크 테스트가 가능하다.
 */
import type { SQLiteDatabase } from 'expo-sqlite';
import {
  SESSIONS_INSERT,
  sessionToParams,
  DAILY_RECORDS_INSERT,
  dailyRecordToParams,
  DIARY_INSERT,
  diaryToParams,
  THOUGHT_NOTES_INSERT,
  thoughtNoteToParams,
  serialize,
  type StudySession,
  type DailyRecord,
  type Settings,
  type DiaryEntry,
  type ThoughtNote,
} from './schema';

export const BACKUP_FORMAT = 'studymeter-backup';
export const SUPPORTED_BACKUP_VERSION = 2;

export interface ParsedBackup {
  version: number;
  sessions: StudySession[];
  dailyRecords: DailyRecord[];
  settings: Settings[];
  thoughtNotes: ThoughtNote[];
  diaryEntries: DiaryEntry[];
  preferences: Record<string, string>;
}

export interface ImportSummary {
  sessions: number;
  dailyRecords: number;
  settings: number;
  thoughtNotes: number;
  diaryEntries: number;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object';
}

/**
 * 백업 JSON 텍스트를 검증·파싱한다 (순수 함수, DB 접근 없음).
 * 형식이 아니거나 최신 버전이면 Error 를 던진다.
 */
export function parseBackup(jsonText: string): ParsedBackup {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    throw new Error('파일을 읽을 수 없습니다. 올바른 JSON 백업 파일이 아닙니다.');
  }

  if (!isRecord(parsed) || parsed.format !== BACKUP_FORMAT || !isRecord(parsed.data)) {
    throw new Error('StudyMeter 백업 파일 형식이 아닙니다.');
  }

  const d = parsed.data;
  if (
    !Array.isArray(d.sessions) ||
    !Array.isArray(d.dailyRecords) ||
    !Array.isArray(d.settings) ||
    !Array.isArray(d.thoughtNotes)
  ) {
    throw new Error('StudyMeter 백업 파일 형식이 아닙니다.');
  }

  const version = typeof parsed.version === 'number' ? parsed.version : 1;
  if (version > SUPPORTED_BACKUP_VERSION) {
    throw new Error(
      `이 백업은 더 최신 버전(v${version})입니다. 앱을 업데이트한 뒤 다시 시도하세요.`
    );
  }

  const diaryEntries = Array.isArray(d.diaryEntries) ? (d.diaryEntries as DiaryEntry[]) : [];
  const preferences =
    isRecord(parsed.preferences) ? (parsed.preferences as Record<string, string>) : {};

  return {
    version,
    sessions: d.sessions as StudySession[],
    dailyRecords: d.dailyRecords as DailyRecord[],
    settings: d.settings as Settings[],
    thoughtNotes: d.thoughtNotes as ThoughtNote[],
    diaryEntries,
    preferences,
  };
}

/**
 * 백업 JSON 을 DB 에 복원한다. 기존 데이터를 전부 지우고 백업 내용으로 교체 (트랜잭션).
 * settings 는 단일 행 저장이므로 배열의 첫 항목만 반영한다.
 * @returns 각 테이블에 반영된 건수
 */
export async function importBackup(jsonText: string, database?: SQLiteDatabase): Promise<ImportSummary> {
  const backup = parseBackup(jsonText);
  // db.ts 는 expo-sqlite 를 로드하므로 지연 import — parseBackup 은 순수하게 유지된다.
  const db: SQLiteDatabase = database ?? (await import('./db').then((m) => m.getDatabase()));

  await db.withTransactionAsync(async () => {
    await db.execAsync(
      'DELETE FROM sessions;' +
        'DELETE FROM dailyRecords;' +
        'DELETE FROM settings;' +
        'DELETE FROM thoughtNotes;' +
        'DELETE FROM diaryEntries;'
    );

    for (const s of backup.sessions) {
      await db.runAsync(SESSIONS_INSERT, sessionToParams(s));
    }
    for (const r of backup.dailyRecords) {
      await db.runAsync(DAILY_RECORDS_INSERT, dailyRecordToParams(r));
    }
    // settings 는 단일 행: 첫 항목만 저장
    if (backup.settings.length > 0) {
      await db.runAsync(
        'INSERT OR REPLACE INTO settings (id, data) VALUES (1, ?)',
        serialize({ ...backup.settings[0], id: 1 }) ?? '{}'
      );
    }
    for (const t of backup.thoughtNotes) {
      await db.runAsync(THOUGHT_NOTES_INSERT, thoughtNoteToParams(t));
    }
    for (const e of backup.diaryEntries) {
      await db.runAsync(DIARY_INSERT, diaryToParams(e));
    }
  });

  return {
    sessions: backup.sessions.length,
    dailyRecords: backup.dailyRecords.length,
    settings: backup.settings.length,
    thoughtNotes: backup.thoughtNotes.length,
    diaryEntries: backup.diaryEntries.length,
  };
}
