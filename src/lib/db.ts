import Dexie, { type EntityTable } from 'dexie';

// 세션 기록 인터페이스
export interface SessionEvaluation {
    focus: number;        // 집중도 1-10
    satisfaction: number; // 만족도 1-10
    problemSolving?: {    // 문제풀이 (선택)
        correct: number;
        total: number;
    };
    memo?: string;        // 간단 메모 (선택)
}

export interface StudySession {
    id?: number;
    date: string; // YYYY-MM-DD
    subject: string;
    type: string; // '자습' | '수업' | '테스트' 등
    startTime: number; // timestamp (ms)
    endTime: number; // timestamp (ms)
    duration: number; // 밀리초
    subItem?: string; // 하위 항목 (예: 국어 > 독서)
    evaluation?: SessionEvaluation; // 세션 평가
}

// 일일 기록 인터페이스
export interface DailyRecord {
    date: string; // YYYY-MM-DD (Primary Key)
    wakeUpTime?: string; // HH:mm
    arrivalTime?: string; // HH:mm
    leaveTime?: string; // HH:mm
    bedTime?: string; // HH:mm
    firstVisitCompleted: boolean;
}

// 과목 인터페이스 (계층 구조)
export interface SubjectItem {
    name: string;
    children?: string[]; // 하위 항목들
}

// 설정 인터페이스
export interface Settings {
    id?: number;
    userName: string;
    subjects: SubjectItem[]; // 변경: string[] -> SubjectItem[]
    types: string[];
    geminiApiKey?: string;
    geminiModel?: string;
    theme: 'light' | 'dark' | 'system';
    profilePicture?: string; // Base64 encoded image for offline storage
    isManualModel?: boolean; // Whether to use manual model name input
    dailyGoalMs?: number; // 일일 목표 공부 시간 (ms)
}

// 세션 중 주차된 생각 인터페이스
export interface ThoughtNote {
    id?: number;
    date: string;            // study day (3am 기준)
    sessionStartTime: number; // 어느 세션에서 주차됐는지
    createdAt: number;       // 주차된 시각
    content: string;
    reviewed: boolean;       // 나중에 검토했는지
}

// Dexie 데이터베이스 클래스
class StudyMeterDB extends Dexie {
    sessions!: EntityTable<StudySession, 'id'>;
    dailyRecords!: EntityTable<DailyRecord, 'date'>;
    settings!: EntityTable<Settings, 'id'>;
    thoughtNotes!: EntityTable<ThoughtNote, 'id'>;

    constructor() {
        super('StudyMeterDB');

        this.version(1).stores({
            sessions: '++id, date, subject, type, startTime',
            dailyRecords: 'date',
            settings: '++id'
        });

        this.version(2).stores({
            sessions: '++id, date, subject, type, startTime',
            dailyRecords: 'date',
            settings: '++id',
            thoughtNotes: '++id, date, sessionStartTime'
        });
    }
}

// 싱글톤 DB 인스턴스
export const db = new StudyMeterDB();

// 기본 설정 초기화
export async function initializeSettings(): Promise<Settings> {
    const existingSettings = await db.settings.toCollection().first();

    if (existingSettings) {
        // 마이그레이션: 기존 string[] 형식을 SubjectItem[] 형식으로 변환
        const migratedSubjects = existingSettings.subjects.map((s: any) => {
            // 이미 SubjectItem 형태인 경우
            if (typeof s === 'object' && s.name) {
                return s as SubjectItem;
            }
            // 기존 string 형태인 경우 변환
            return { name: String(s) } as SubjectItem;
        });

        // 마이그레이션 필요한 경우 업데이트
        if (existingSettings.subjects.some((s: any) => typeof s === 'string')) {
            existingSettings.subjects = migratedSubjects;
            await db.settings.update(existingSettings.id!, { subjects: migratedSubjects });
        }

        return { ...existingSettings, subjects: migratedSubjects };
    }

    const defaultSettings: Settings = {
        userName: '사용자',
        subjects: [
            { name: '국어', children: ['독서', '문학', '언매'] },
            { name: '수학', children: ['수학I', '수학II', '미적분', '확률과 통계'] },
            { name: '영어', children: ['구문해석', '독해'] },
            { name: '사문' },
            { name: '지구' },
            { name: '기타' }
        ],
        types: ['자습', '수업', '테스트', '과제'],
        theme: 'system'
    };

    await db.settings.add(defaultSettings);
    return defaultSettings;
}

// 새벽 3시 기준으로 날짜 조정 (0~2시는 전날로 처리)
function adjustForStudyDay(date: Date): Date {
    const adjusted = new Date(date);
    if (adjusted.getHours() < 3) {
        adjusted.setDate(adjusted.getDate() - 1);
    }
    return adjusted;
}

// 오늘 날짜 가져오기 (YYYY-MM-DD) - 새벽 3시 기준 (0~2시는 전날로 처리)
export function getTodayDate(): string {
    return formatDateYYYYMMDD(adjustForStudyDay(new Date()));
}

// 오늘 기준 Date 객체 반환 (새벽 3시 기준)
export function getStudyToday(): Date {
    const d = adjustForStudyDay(new Date());
    d.setHours(0, 0, 0, 0);
    return d;
}

// 타임스탬프에서 날짜 추출 (YYYY-MM-DD) - 새벽 3시 기준
export function getDateFromTimestamp(timestamp: number): string {
    return formatDateYYYYMMDD(adjustForStudyDay(new Date(timestamp)));
}

// Date 객체를 YYYY-MM-DD 형식으로 변환 (로컬 시간 기준)
export function formatDateYYYYMMDD(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

// 타임스탬프를 HH:mm 형식으로 변환 (로컬 시간)
export function formatTimeHHMM(timestamp: number): string {
    const date = new Date(timestamp);
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${hours}:${minutes}`;
}

// 주어진 날짜가 속한 주의 월요일 구하기
export function getMonday(d: Date): Date {
    const date = new Date(d);
    date.setHours(0, 0, 0, 0);
    const day = date.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    date.setDate(date.getDate() + diff);
    return date;
}

// 월요일로부터 일요일 구하기
export function getSunday(monday: Date): Date {
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    sunday.setHours(23, 59, 59, 999);
    return sunday;
}

// 오늘이 첫 접속인지 확인
export async function isFirstVisitToday(): Promise<boolean> {
    const today = getTodayDate();
    const record = await db.dailyRecords.get(today);
    return !record || !record.firstVisitCompleted;
}

// 일일 기록 생성 또는 업데이트
export async function updateDailyRecord(data: Partial<DailyRecord>): Promise<void> {
    const today = getTodayDate();
    const existing = await db.dailyRecords.get(today);

    if (existing) {
        await db.dailyRecords.update(today, data);
    } else {
        await db.dailyRecords.add({
            date: today,
            firstVisitCompleted: false,
            ...data
        });
    }
}

// 오늘 총 공부 시간 계산 (ms)
export async function getTodayTotalStudyTime(): Promise<number> {
    const today = getTodayDate();
    const sessions = await db.sessions.where('date').equals(today).toArray();
    return sessions.reduce((total, session) => total + session.duration, 0);
}

// 오늘 과목별 공부 시간 계산
export async function getTodayStudyTimeBySubject(): Promise<Map<string, { total: number; selfStudy: number }>> {
    const today = getTodayDate();
    const sessions = await db.sessions.where('date').equals(today).toArray();

    const result = new Map<string, { total: number; selfStudy: number }>();

    for (const session of sessions) {
        const existing = result.get(session.subject) || { total: 0, selfStudy: 0 };
        existing.total += session.duration;
        if (session.type === '자습' || session.type === '테스트') {
            existing.selfStudy += session.duration;
        }
        result.set(session.subject, existing);
    }

    return result;
}

// 시간 포맷팅 (ms -> HH:MM:SS)
export function formatDuration(ms: number): string {
    const totalSeconds = Math.floor(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

// 시간 포맷팅 with 소수점 (ms -> HH:MM:SS.X)
export function formatDurationWithDecimal(ms: number): string {
    const totalSeconds = ms / 1000;
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = (totalSeconds % 60).toFixed(1);

    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.padStart(4, '0')}`;
}

// 세션 삭제
export async function deleteStudySession(id: number): Promise<void> {
    await db.sessions.delete(id);
}

// 세션 수정
export async function updateStudySession(id: number, data: Partial<StudySession>): Promise<void> {
    await db.sessions.update(id, data);
}

// 시간 포맷팅 (ms -> Xh Ym) - 초 반올림
export function formatDurationHourMinute(ms: number): string {
    const totalSeconds = Math.round(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    if (hours > 0) {
        return `${hours}h ${minutes}m`;
    }
    return `${minutes}m`;
}

// 특정 시간 범위에 겹치는 세션 찾기 (전체 범위 겹침 확인)
export async function findOverlappingSession(
    date: string,
    startTime: number,
    excludeId?: number,
    endTime?: number
): Promise<StudySession | null> {
    const sessions = await db.sessions.where('date').equals(date).toArray();
    const checkEnd = endTime ?? startTime + 1;
    return sessions.find(s =>
        s.id !== excludeId &&
        s.startTime < checkEnd &&
        s.endTime > startTime
    ) || null;
}

// 해당 날짜의 가장 늦은 종료 시간 가져오기
export async function getLatestEndTime(date: string, excludeId?: number): Promise<number | null> {
    const sessions = await db.sessions.where('date').equals(date).toArray();
    const filtered = excludeId ? sessions.filter(s => s.id !== excludeId) : sessions;
    if (filtered.length === 0) return null;
    return Math.max(...filtered.map(s => s.endTime));
}

// 현재 시간에 진행 중인 세션 찾기 (스톱워치 시작용)
export async function findActiveSessionAtTime(timestamp: number): Promise<StudySession | null> {
    const date = getDateFromTimestamp(timestamp);
    const sessions = await db.sessions.where('date').equals(date).toArray();
    return sessions.find(s =>
        s.startTime <= timestamp &&
        s.endTime > timestamp
    ) || null;
}

// 겹치는 세션의 종료 시간 조정
export async function adjustOverlappingSession(
    sessionId: number,
    newEndTime: number
): Promise<void> {
    const session = await db.sessions.get(sessionId);
    if (session) {
        const newDuration = newEndTime - session.startTime;
        await db.sessions.update(sessionId, {
            endTime: newEndTime,
            duration: newDuration
        });
    }
}

// ── 생각 주차장 헬퍼 ─────────────────────────────────────────────────────────

export async function addThoughtNote(note: Omit<ThoughtNote, 'id'>): Promise<number> {
    return await db.thoughtNotes.add(note) as number;
}

export async function getThoughtNotesBySessionStart(sessionStartTime: number): Promise<ThoughtNote[]> {
    return await db.thoughtNotes.where('sessionStartTime').equals(sessionStartTime).sortBy('createdAt');
}

export async function markThoughtsReviewed(ids: number[]): Promise<void> {
    await Promise.all(ids.map(id => db.thoughtNotes.update(id, { reviewed: true })));
}

export async function getUnreviewedThoughtNotes(): Promise<ThoughtNote[]> {
    const all = await db.thoughtNotes.toArray();
    return all.filter(n => !n.reviewed).sort((a, b) => b.createdAt - a.createdAt);
}
