import Dexie, { type EntityTable } from 'dexie';

// 세션 기록 인터페이스
export interface SessionEvaluation {
    /** 통합 세션 점수 1-10 (신규 방식). 구 데이터는 focus/satisfaction 만 있을 수 있다. */
    score?: number;
    /** 세션 태그 ('졸음', '완전 몰입' 등) */
    tags?: string[];
    focus?: number;       // (레거시) 집중도 1-10
    satisfaction?: number; // (레거시) 만족도 1-10
    problemSolving?: {    // 문제풀이 (선택)
        correct: number;
        total: number;
    };
    memo?: string;        // 간단 메모 (선택)
}

/** 신/구 평가 데이터에서 통합 점수(1-10)를 얻는다. 없으면 null. */
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
    type: string; // '자습' | '수업' | '테스트' 등
    startTime: number; // timestamp (ms)
    endTime: number; // timestamp (ms)
    duration: number; // 밀리초
    subItem?: string; // 하위 항목 (예: 국어 > 독서)
    evaluation?: SessionEvaluation; // 세션 평가
    drowsyCount?: number; // 세션 중 카메라가 감지한 졸음 경고 횟수
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

// ── AI 역할/태그 관련 타입 ───────────────────────────────────────────────────

/** AI 역할: 기능이 모델을 직접 고르지 않고 역할만 선언한다. */
export type AiRole = 'deep' | 'interactive' | 'ambient';

/** 평가 태그 정의. 프리셋 + 사용자 커스텀 공용. */
export interface EvalTag {
    name: string;
    category: 'obstacle' | 'condition' | 'good' | 'context' | 'day';
    /** 노출 범위: 세션 평가 / 하루 일기 / 양쪽 */
    scope: 'session' | 'day' | 'both';
    hidden?: boolean;  // 사용자가 숨김
    custom?: boolean;  // 사용자가 추가함
}

/** 기능별 시스템 프롬프트 오버라이드 (undefined = 기본 프롬프트 사용) */
export interface AiSystemPrompts {
    base?: string;          // 공통 페르소나 (모든 기능 앞에 붙음)
    chat?: string;          // 채팅 코치
    morningReport?: string; // 아침/주간 리포트
    diaryDraft?: string;    // 일기 한마디 초안
    diaryReply?: string;    // 일기 AI 답장
    sessionComment?: string;// 세션 종료 코멘트
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
    drowsinessThresholdSec?: number; // 졸음 판단 기준: 눈 감김 지속 시간(초). 기본 15
    // ── AI 통합 설정 ────────────────────────────────────────────────
    advancedMode?: boolean;          // 고급 모드 (모델/프롬프트 편집 노출)
    aiAmbientEnabled?: boolean;      // 앰비언트 AI (리포트·답장·코멘트). 기본 true
    /** 역할별 모델 오버라이드. 빈 값/undefined = 자동(별칭 기본값) */
    aiRoleModels?: Partial<Record<AiRole, string>>;
    /** 기능별 시스템 프롬프트 오버라이드 */
    aiSystemPrompts?: AiSystemPrompts;
    /** 평가 태그 목록 (undefined = 기본 프리셋 사용) */
    evalTags?: EvalTag[];
    morningReportHour?: number;      // 아침 리포트 알림 시각 (0-23). 기본 7
    morningReportEnabled?: boolean;  // 아침 리포트 알림. 기본 true
}

// ── 일기 인터페이스 ─────────────────────────────────────────────────────────

/** 하루 일기의 자동 집계 스냅샷 (확정 시점에 고정) */
export interface DiaryStats {
    totalMs: number;
    selfStudyMs: number;
    goalPct: number | null;   // 목표 미설정 시 null
    sessionCount: number;
    avgScore: number | null;  // 세션 평균 점수 (평가 없으면 null)
    drowsyCount: number;
    bySubject: Array<{ subject: string; ms: number }>;
}

export interface DiaryEntry {
    date: string;             // YYYY-MM-DD (Primary Key, 3am 기준)
    score: number;            // 오늘 점수 1-10
    dayTags: string[];        // 하루 태그 (세션 승계 + 하루 전용)
    oneLiner?: string;        // 나의 한마디
    oneLinerSource?: 'ai' | 'ai-edited' | 'user' | 'voice';
    aiReply?: string;         // AI 답장 (마크다운)
    auto: boolean;            // 사용자가 확정하지 않아 자동 확정됐는지
    stats: DiaryStats;
    createdAt: number;
    updatedAt: number;
}

/** 앰비언트 AI 생성물 캐시. kind+date 로 하루 1회 생성을 보장한다. */
export interface AiArtifact {
    id?: number;
    kind: string;             // 'morning-report' | 'weekly-report' | 'diary-draft' | 'diary-reply' | 'session-comment' | ...
    date: string;             // 기준 날짜 (YYYY-MM-DD)
    content: string;          // 마크다운
    model: string;            // 생성 모델
    createdAt: number;
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
    diaryEntries!: EntityTable<DiaryEntry, 'date'>;
    aiArtifacts!: EntityTable<AiArtifact, 'id'>;

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

        this.version(3).stores({
            sessions: '++id, date, subject, type, startTime',
            dailyRecords: 'date',
            settings: '++id',
            thoughtNotes: '++id, date, sessionStartTime',
            diaryEntries: 'date',
            aiArtifacts: '++id, date, [kind+date]'
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
        // (런타임상 레거시 데이터는 (SubjectItem | string)[] 일 수 있음)
        const legacySubjects = existingSettings.subjects as Array<SubjectItem | string>;
        const migratedSubjects: SubjectItem[] = legacySubjects.map((s) =>
            typeof s === 'string' ? { name: s } : s
        );

        // 마이그레이션 필요한 경우 업데이트
        if (legacySubjects.some((s) => typeof s === 'string')) {
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
        theme: 'system',
        drowsinessThresholdSec: 15
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

// ── 일기 헬퍼 ───────────────────────────────────────────────────────────────

/** 특정 날짜의 자동 집계 스냅샷을 계산한다. */
export async function computeDiaryStats(date: string, dailyGoalMs?: number): Promise<DiaryStats> {
    const sessions = await db.sessions.where('date').equals(date).toArray();
    const totalMs = sessions.reduce((sum, s) => sum + s.duration, 0);
    const selfStudyMs = sessions
        .filter(s => s.type === '자습' || s.type === '테스트')
        .reduce((sum, s) => sum + s.duration, 0);
    const scores = sessions
        .map(s => getEvalScore(s.evaluation))
        .filter((v): v is number => v !== null);
    const drowsyCount = sessions.reduce((sum, s) => sum + (s.drowsyCount ?? 0), 0);
    const bySubjectMap = new Map<string, number>();
    for (const s of sessions) {
        bySubjectMap.set(s.subject, (bySubjectMap.get(s.subject) ?? 0) + s.duration);
    }
    return {
        totalMs,
        selfStudyMs,
        goalPct: dailyGoalMs && dailyGoalMs > 0 ? Math.round((totalMs / dailyGoalMs) * 100) : null,
        sessionCount: sessions.length,
        avgScore: scores.length ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10 : null,
        drowsyCount,
        bySubject: Array.from(bySubjectMap.entries())
            .map(([subject, ms]) => ({ subject, ms }))
            .sort((a, b) => b.ms - a.ms),
    };
}

/** 세션 태그를 하루 태그로 승계 (중복 제거). */
export async function collectSessionTags(date: string): Promise<string[]> {
    const sessions = await db.sessions.where('date').equals(date).toArray();
    const tags = new Set<string>();
    for (const s of sessions) {
        for (const t of s.evaluation?.tags ?? []) tags.add(t);
    }
    return Array.from(tags);
}

/**
 * 일기 점수 자동 제안 (1-10).
 * 세션 평균 점수를 기본으로, 목표 달성률로 보정하고 졸음 횟수만큼 감점한다.
 */
export function suggestDiaryScore(stats: DiaryStats): number {
    let score: number;
    if (stats.avgScore !== null) {
        score = stats.avgScore;
    } else if (stats.goalPct !== null) {
        score = 3 + (Math.min(stats.goalPct, 120) / 120) * 7;
    } else if (stats.totalMs > 0) {
        score = 6;
    } else {
        score = 5;
    }
    if (stats.goalPct !== null) {
        if (stats.goalPct >= 100) score += 1;
        else if (stats.goalPct < 50) score -= 1;
    }
    score -= Math.min(2, stats.drowsyCount * 0.5);
    return Math.max(1, Math.min(10, Math.round(score)));
}

export async function getDiaryEntry(date: string): Promise<DiaryEntry | undefined> {
    return db.diaryEntries.get(date);
}

export async function saveDiaryEntry(entry: DiaryEntry): Promise<void> {
    await db.diaryEntries.put(entry);
}

export async function getDiaryRange(startDate: string, endDate: string): Promise<DiaryEntry[]> {
    return db.diaryEntries.where('date').between(startDate, endDate, true, true).toArray();
}

/**
 * 어제까지의 미확정 날짜들을 자동 확정한다 (일기 공백일 방지).
 * 세션이 하나라도 있는데 일기가 없는 날만 대상으로 한다.
 */
export async function autoFinalizeMissedDiaries(dailyGoalMs?: number): Promise<number> {
    const today = getTodayDate();
    const dates = (await db.sessions.orderBy('date').uniqueKeys()) as string[];
    let finalized = 0;
    for (const date of dates) {
        if (date >= today) continue;
        const existing = await db.diaryEntries.get(date);
        if (existing) continue;
        const stats = await computeDiaryStats(date, dailyGoalMs);
        const now = Date.now();
        await db.diaryEntries.put({
            date,
            score: suggestDiaryScore(stats),
            dayTags: await collectSessionTags(date),
            auto: true,
            stats,
            createdAt: now,
            updatedAt: now,
        });
        finalized++;
    }
    return finalized;
}

/**
 * 일기 연속 작성일(스트릭). 직접 확정(auto=false)한 일기만 센다.
 * 오늘 아직 안 썼으면 어제까지의 연속을 반환한다 (오늘 몫은 아직 깨진 게 아님).
 */
export async function getDiaryStreak(today: string): Promise<number> {
    const entries = await db.diaryEntries.where('date').belowOrEqual(today).toArray();
    const written = new Set(entries.filter(e => !e.auto).map(e => e.date));
    let streak = 0;
    const cursor = new Date(today + 'T12:00:00');
    if (!written.has(today)) cursor.setDate(cursor.getDate() - 1); // 오늘 미작성은 어제부터 카운트
    for (;;) {
        const dateStr = formatDateYYYYMMDD(cursor);
        if (!written.has(dateStr)) break;
        streak++;
        cursor.setDate(cursor.getDate() - 1);
    }
    return streak;
}

// ── AI 생성물 캐시 헬퍼 ─────────────────────────────────────────────────────

export async function getAiArtifact(kind: string, date: string): Promise<AiArtifact | undefined> {
    return db.aiArtifacts.where('[kind+date]').equals([kind, date]).first();
}

export async function putAiArtifact(artifact: Omit<AiArtifact, 'id'>): Promise<void> {
    const existing = await getAiArtifact(artifact.kind, artifact.date);
    if (existing) {
        await db.aiArtifacts.update(existing.id!, { ...artifact });
    } else {
        await db.aiArtifacts.add(artifact);
    }
}
