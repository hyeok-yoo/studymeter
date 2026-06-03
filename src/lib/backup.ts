/**
 * backup.ts — 설정/데이터 내보내기·가져오기 (백업/복원)
 *
 * 재설치·기기 변경 시 데이터를 옮길 수 있도록 IndexedDB(Dexie)의 모든 테이블과
 * 일부 localStorage 환경설정을 단일 JSON 파일로 직렬화한다.
 *
 * - 네이티브(Capacitor): Filesystem에 임시 파일로 쓴 뒤 Share 시트로 저장/전송
 * - 웹(PWA): Blob 다운로드
 */
import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import {
    db,
    type StudySession,
    type DailyRecord,
    type Settings,
    type ThoughtNote,
} from './db';

export const BACKUP_FORMAT = 'studymeter-backup';
export const BACKUP_VERSION = 1;

/** 함께 백업하는 localStorage 키들 (집중 측정 서버 주소 등) */
const LOCAL_STORAGE_KEYS = ['focus_server_url'] as const;

export interface BackupFile {
    format: typeof BACKUP_FORMAT;
    version: number;
    exportedAt: string; // ISO 8601
    appVersion: string;
    data: {
        sessions: StudySession[];
        dailyRecords: DailyRecord[];
        settings: Settings[];
        thoughtNotes: ThoughtNote[];
    };
    preferences: Record<string, string>;
}

export interface ImportSummary {
    sessions: number;
    dailyRecords: number;
    settings: number;
    thoughtNotes: number;
}

/** 현재 DB + 환경설정을 BackupFile 객체로 수집한다. */
export async function collectBackup(appVersion: string): Promise<BackupFile> {
    const [sessions, dailyRecords, settings, thoughtNotes] = await Promise.all([
        db.sessions.toArray(),
        db.dailyRecords.toArray(),
        db.settings.toArray(),
        db.thoughtNotes.toArray(),
    ]);

    const preferences: Record<string, string> = {};
    for (const key of LOCAL_STORAGE_KEYS) {
        const value = localStorage.getItem(key);
        if (value !== null) preferences[key] = value;
    }

    return {
        format: BACKUP_FORMAT,
        version: BACKUP_VERSION,
        exportedAt: new Date().toISOString(),
        appVersion,
        data: { sessions, dailyRecords, settings, thoughtNotes },
        preferences,
    };
}

function buildFileName(): string {
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
    return `studymeter-backup-${stamp}.json`;
}

/**
 * 백업 파일을 저장/공유한다.
 * 네이티브에서는 Share 시트로 저장 위치를 사용자가 고르고, 웹에서는 다운로드된다.
 */
export async function exportBackup(appVersion: string): Promise<void> {
    const backup = await collectBackup(appVersion);
    const json = JSON.stringify(backup, null, 2);
    const fileName = buildFileName();

    if (Capacitor.isNativePlatform()) {
        const result = await Filesystem.writeFile({
            path: fileName,
            data: json,
            directory: Directory.Cache,
            encoding: Encoding.UTF8,
        });
        await Share.share({
            title: 'StudyMeter 백업',
            text: 'StudyMeter 설정 및 데이터 백업 파일',
            url: result.uri,
            dialogTitle: '백업 파일 저장/전송',
        });
    } else {
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        // 일부 브라우저에서 즉시 revoke 시 다운로드가 취소되므로 약간 지연
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
}

function isBackupFile(obj: unknown): obj is BackupFile {
    if (!obj || typeof obj !== 'object') return false;
    const o = obj as Record<string, unknown>;
    if (o.format !== BACKUP_FORMAT) return false;
    if (!o.data || typeof o.data !== 'object') return false;
    const d = o.data as Record<string, unknown>;
    return (
        Array.isArray(d.sessions) &&
        Array.isArray(d.dailyRecords) &&
        Array.isArray(d.settings) &&
        Array.isArray(d.thoughtNotes)
    );
}

/**
 * 백업 JSON 텍스트를 파싱하여 DB를 복원한다.
 * 기존 데이터를 모두 지우고 백업 내용으로 교체한다 (전체 교체, 트랜잭션 보장).
 */
export async function importBackup(jsonText: string): Promise<ImportSummary> {
    let parsed: unknown;
    try {
        parsed = JSON.parse(jsonText);
    } catch {
        throw new Error('파일을 읽을 수 없습니다. 올바른 JSON 백업 파일이 아닙니다.');
    }

    if (!isBackupFile(parsed)) {
        throw new Error('StudyMeter 백업 파일 형식이 아닙니다.');
    }

    const backup = parsed;
    if (backup.version > BACKUP_VERSION) {
        throw new Error(
            `이 백업은 더 최신 버전(v${backup.version})입니다. 앱을 업데이트한 뒤 다시 시도하세요.`
        );
    }

    const { sessions, dailyRecords, settings, thoughtNotes } = backup.data;

    await db.transaction('rw', db.sessions, db.dailyRecords, db.settings, db.thoughtNotes, async () => {
        await Promise.all([
            db.sessions.clear(),
            db.dailyRecords.clear(),
            db.settings.clear(),
            db.thoughtNotes.clear(),
        ]);
        await db.sessions.bulkAdd(sessions);
        await db.dailyRecords.bulkAdd(dailyRecords);
        await db.settings.bulkAdd(settings);
        await db.thoughtNotes.bulkAdd(thoughtNotes);
    });

    // 환경설정(localStorage) 복원
    if (backup.preferences && typeof backup.preferences === 'object') {
        for (const key of LOCAL_STORAGE_KEYS) {
            const value = backup.preferences[key];
            if (typeof value === 'string') localStorage.setItem(key, value);
        }
    }

    return {
        sessions: sessions.length,
        dailyRecords: dailyRecords.length,
        settings: settings.length,
        thoughtNotes: thoughtNotes.length,
    };
}
