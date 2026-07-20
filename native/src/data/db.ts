/**
 * db.ts — expo-sqlite(SDK 57 next API) 초기화 + 마이그레이션 러너.
 *
 * SDK 57 방식:
 *  - openDatabaseSync(name) 로 동기 오픈
 *  - execAsync / getFirstAsync / getAllAsync / runAsync / withTransactionAsync 사용
 *
 * 스키마 버전은 `PRAGMA user_version` 으로 관리한다. 앱 부팅 시 initDatabase() 를
 * 한 번 호출하면 필요한 마이그레이션이 순서대로 적용된다.
 */
import { openDatabaseSync, type SQLiteDatabase } from 'expo-sqlite';
import { MIGRATIONS, SCHEMA_VERSION } from './schema';

export const DATABASE_NAME = 'studymeter.db';

let _db: SQLiteDatabase | null = null;
let _initPromise: Promise<SQLiteDatabase> | null = null;

/** 동기 핸들. 이미 열려 있으면 재사용한다. 최초 사용 전 getDatabase()/initDatabase() 권장. */
export function getDb(): SQLiteDatabase {
  if (!_db) {
    _db = openDatabaseSync(DATABASE_NAME);
  }
  return _db;
}

/** user_version 을 읽어 SCHEMA_VERSION 까지 마이그레이션을 적용한다. */
export async function runMigrations(db: SQLiteDatabase): Promise<void> {
  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  const current = row?.user_version ?? 0;

  for (let v = current + 1; v <= SCHEMA_VERSION; v++) {
    const ddl = MIGRATIONS[v];
    if (!ddl) continue;
    // 한 버전의 DDL + user_version 갱신을 하나의 트랜잭션으로 원자 적용.
    // (PRAGMA user_version 은 바인딩 불가 → 정수 v 를 직접 삽입, 안전)
    await db.withTransactionAsync(async () => {
      await db.execAsync(ddl);
      await db.execAsync(`PRAGMA user_version = ${v}`);
    });
  }
}

/** 앱 부팅 시 1회 호출. DB 오픈 + PRAGMA + 마이그레이션. 중복 호출은 동일 Promise 공유. */
export function initDatabase(): Promise<SQLiteDatabase> {
  if (_initPromise) return _initPromise;
  _initPromise = (async () => {
    const db = getDb();
    await db.execAsync('PRAGMA journal_mode = WAL;');
    await db.execAsync('PRAGMA foreign_keys = ON;');
    await runMigrations(db);
    return db;
  })();
  return _initPromise;
}

/** 초기화까지 보장하고 핸들을 돌려준다. DAO 내부에서 사용. */
export async function getDatabase(): Promise<SQLiteDatabase> {
  return initDatabase();
}
