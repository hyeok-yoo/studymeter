/**
 * functions.ts — AI 함수 호출(function calling) 레지스트리. (React Native 포팅)
 *
 * 웹 src/lib/ai/functions.ts 를 이식하되 Dexie 호출을 dao 호출로 교체한다.
 * 세션 겹침 체크(findOverlappingSession)는 dao 에 없으므로 getSessionsByDate 로
 * 로컬 재구성한다. 실행기는 전부 로컬 DB 작업이며, 결과는 모델에게 돌려줄 JSON.
 * 저장류 함수는 시스템 프롬프트에서 "사용자가 명확히 요청했을 때만" 호출하도록 지시된다.
 */
import {
    formatTimeHHMM,
    getDateFromTimestamp,
    getDiaryEntry,
    getDiaryRange,
    getSessionsByDate,
    getTodayDate,
    saveDiaryEntry,
    saveSession,
} from '../data/dao';
import type { Settings, StudySession } from '../data/schema';
import { buildDaySnapshot, buildRecentDaysSnapshot, collectSessionTags, computeDiaryStats, suggestDiaryScore } from './snapshot';
import type { GeminiFunctionDeclaration } from './gemini';

export const CHAT_FUNCTION_DECLARATIONS: GeminiFunctionDeclaration[] = [
    {
        name: 'get_study_data',
        description: '지정한 날짜 범위의 공부 기록(시간·세션·점수·태그) 요약을 조회한다. 하루면 세션 상세 포함.',
        parameters: {
            type: 'object',
            properties: {
                start_date: { type: 'string', description: 'YYYY-MM-DD. 생략 시 오늘' },
                end_date: { type: 'string', description: 'YYYY-MM-DD. 생략 시 start_date 와 동일' },
            },
        },
    },
    {
        name: 'get_diary',
        description: '지정한 날짜 범위의 일기(점수·태그·한마디·AI답장)를 조회한다. 회고/패턴 질문에 사용.',
        parameters: {
            type: 'object',
            properties: {
                start_date: { type: 'string', description: 'YYYY-MM-DD' },
                end_date: { type: 'string', description: 'YYYY-MM-DD' },
            },
            required: ['start_date', 'end_date'],
        },
    },
    {
        name: 'log_session',
        description: '측정하지 못한 공부 세션을 기록한다 (예: "학원에서 수학 2시간 들었어"). 사용자가 기록을 요청했을 때만 호출.',
        parameters: {
            type: 'object',
            properties: {
                subject: { type: 'string', description: '과목명' },
                type: { type: 'string', description: "세션 유형: '자습'|'수업'|'테스트'|'과제' 등" },
                minutes: { type: 'number', description: '공부 시간(분)' },
                date: { type: 'string', description: 'YYYY-MM-DD. 생략 시 오늘' },
                start_hhmm: { type: 'string', description: '시작 시각 HH:mm. 생략 시 지금 끝난 것으로 역산' },
                score: { type: 'number', description: '세션 점수 1-10 (선택)' },
                tags: { type: 'array', items: { type: 'string' }, description: "세션 태그 (선택, 예: ['졸음'])" },
                memo: { type: 'string', description: '한마디 메모 (선택)' },
            },
            required: ['subject', 'type', 'minutes'],
        },
    },
    {
        name: 'save_diary',
        description: '오늘(또는 지정일)의 하루 일기를 저장/수정한다. 사용자가 일기 작성을 요청했을 때만 호출.',
        parameters: {
            type: 'object',
            properties: {
                score: { type: 'number', description: '오늘 점수 1-10. 생략 시 데이터 기반 자동 제안' },
                one_liner: { type: 'string', description: '나의 한마디 (1인칭 한 문장)' },
                tags: { type: 'array', items: { type: 'string' }, description: '하루 태그' },
                date: { type: 'string', description: 'YYYY-MM-DD. 생략 시 오늘' },
            },
        },
    },
];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function normalizeDate(input: unknown, fallback: string): string {
    return typeof input === 'string' && DATE_RE.test(input) ? input : fallback;
}

/**
 * 특정 시간 범위에 겹치는 세션 찾기 (전체 범위 겹침 확인). 웹 db.ts findOverlappingSession 포팅.
 * dao 에 없어 getSessionsByDate 로 로컬 재구성한다.
 */
async function findOverlappingSession(
    date: string,
    startTime: number,
    excludeId?: number,
    endTime?: number,
): Promise<StudySession | null> {
    const sessions = await getSessionsByDate(date);
    const checkEnd = endTime ?? startTime + 1;
    return sessions.find(s =>
        s.id !== excludeId &&
        s.startTime < checkEnd &&
        s.endTime > startTime
    ) || null;
}

/** 함수 하나를 실행하고 모델에 돌려줄 응답 객체를 반환한다. 실패도 텍스트로 돌려줘 모델이 사용자에게 설명하게 한다. */
export async function executeChatFunction(
    name: string,
    args: Record<string, unknown>,
    settings: Settings,
): Promise<Record<string, unknown>> {
    try {
        switch (name) {
            case 'get_study_data': {
                const start = normalizeDate(args.start_date, getTodayDate());
                const end = normalizeDate(args.end_date, start);
                if (start === end) {
                    return { summary: await buildDaySnapshot(start, settings.dailyGoalMs, true) };
                }
                const days = Math.min(31, Math.round((new Date(end).getTime() - new Date(start).getTime()) / 86400000) + 1);
                return { summary: await buildRecentDaysSnapshot(end, Math.max(1, days), settings.dailyGoalMs) };
            }
            case 'get_diary': {
                const start = normalizeDate(args.start_date, getTodayDate());
                const end = normalizeDate(args.end_date, start);
                const entries = await getDiaryRange(start, end);
                return {
                    count: entries.length,
                    entries: entries.map(e => ({
                        date: e.date,
                        score: e.score,
                        tags: e.dayTags,
                        one_liner: e.oneLiner ?? null,
                        auto_finalized: e.auto,
                        total_study: Math.round(e.stats.totalMs / 60000) + '분',
                    })),
                };
            }
            case 'log_session': {
                const subject = String(args.subject ?? '').trim();
                const type = String(args.type ?? '').trim() || '자습';
                const minutes = Number(args.minutes);
                if (!subject || !Number.isFinite(minutes) || minutes <= 0 || minutes > 24 * 60) {
                    return { error: '과목명과 올바른 분 단위 시간이 필요합니다.' };
                }
                const durationMs = Math.round(minutes * 60000);
                const date = normalizeDate(args.date, getTodayDate());
                let startTime: number;
                if (typeof args.start_hhmm === 'string' && /^\d{1,2}:\d{2}$/.test(args.start_hhmm)) {
                    const [h, m] = args.start_hhmm.split(':').map(Number);
                    const base = new Date(date + 'T00:00:00');
                    base.setHours(h, m, 0, 0);
                    startTime = base.getTime();
                } else {
                    startTime = Date.now() - durationMs;
                }
                const endTime = startTime + durationMs;
                const overlap = await findOverlappingSession(getDateFromTimestamp(startTime), startTime, undefined, endTime);
                if (overlap) {
                    return {
                        error: `해당 시간대에 이미 기록이 있습니다 (${overlap.subject}, ${formatTimeHHMM(overlap.startTime)}~${formatTimeHHMM(overlap.endTime)}). 시작 시각을 알려주면 다시 기록할 수 있습니다.`,
                    };
                }
                const score = Number(args.score);
                const tags = Array.isArray(args.tags) ? args.tags.map(String).slice(0, 8) : undefined;
                const memo = typeof args.memo === 'string' && args.memo.trim() ? args.memo.trim() : undefined;
                const hasEval = Number.isFinite(score) || tags?.length || memo;
                const session: StudySession = {
                    date: getDateFromTimestamp(startTime),
                    subject,
                    type,
                    startTime,
                    endTime,
                    duration: durationMs,
                    ...(hasEval ? {
                        evaluation: {
                            ...(Number.isFinite(score) ? { score: Math.max(1, Math.min(10, Math.round(score))) } : {}),
                            ...(tags?.length ? { tags } : {}),
                            ...(memo ? { memo } : {}),
                        },
                    } : {}),
                };
                const id = await saveSession(session);
                return { ok: true, session_id: id, date: session.date, saved: `${subject} ${type} ${minutes}분` };
            }
            case 'save_diary': {
                const date = normalizeDate(args.date, getTodayDate());
                const stats = await computeDiaryStats(date, settings.dailyGoalMs);
                const existing = await getDiaryEntry(date);
                const scoreArg = Number(args.score);
                const score = Number.isFinite(scoreArg)
                    ? Math.max(1, Math.min(10, Math.round(scoreArg)))
                    : existing?.score ?? suggestDiaryScore(stats);
                const tags = Array.isArray(args.tags)
                    ? args.tags.map(String).slice(0, 12)
                    : existing?.dayTags ?? await collectSessionTags(date);
                const oneLiner = typeof args.one_liner === 'string' && args.one_liner.trim()
                    ? args.one_liner.trim()
                    : existing?.oneLiner;
                const now = Date.now();
                await saveDiaryEntry({
                    date,
                    score,
                    dayTags: tags,
                    oneLiner,
                    oneLinerSource: typeof args.one_liner === 'string' && args.one_liner.trim() ? 'user' : existing?.oneLinerSource,
                    aiReply: existing?.aiReply,
                    auto: false,
                    stats,
                    createdAt: existing?.createdAt ?? now,
                    updatedAt: now,
                });
                return { ok: true, date, score, tags, one_liner: oneLiner ?? null };
            }
            default:
                return { error: `알 수 없는 함수: ${name}` };
        }
    } catch (e) {
        return { error: e instanceof Error ? e.message : '함수 실행 중 오류가 발생했습니다.' };
    }
}
