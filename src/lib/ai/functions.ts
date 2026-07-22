/**
 * functions.ts — AI 함수 호출(function calling) 레지스트리.
 *
 * 채팅에서 모델이 앱 데이터를 조회/기록할 수 있게 하는 함수 선언과 실행기.
 * 실행기는 전부 로컬 DB(Dexie) 작업이며, 결과는 모델에게 돌려줄 JSON 으로 반환한다.
 * 저장류 함수는 시스템 프롬프트에서 "사용자가 명확히 요청했을 때만" 호출하도록 지시된다.
 */
import {
    db,
    computeDiaryStats,
    collectSessionTags,
    findOverlappingSession,
    getDateFromTimestamp,
    getDiaryRange,
    getTodayDate,
    getWeekKey,
    suggestDiaryScore,
    currentPeriodKey,
    getTodos,
    addTodo,
    toggleTodo,
    saveWeeklyDiary,
    getWeeklyDiary,
    addLearningNote,
    type Settings,
    type StudySession,
    type TodoScope,
} from '../db';
import { searchLearningNotes, attachEmbedding } from './rag';
import { buildDaySnapshot, buildRecentDaysSnapshot } from './snapshot';
import type { GeminiFunctionDeclaration } from '../gemini';

/**
 * 채팅 함수 선언 목록을 사용자의 설정(과목·유형 목록)에 맞춰 만든다.
 * 과목/유형 파라미터에는 사용자의 실제 목록을 OpenAPI enum 으로 넣어
 * 모델이 존재하지 않는 과목을 지어내 데이터를 오염시키는 것을 막는다.
 */
export function buildChatFunctionDeclarations(settings: Settings): GeminiFunctionDeclaration[] {
    const subjectNames = settings.subjects.map((s) => s.name).filter(Boolean);
    const typeNames = (settings.types ?? []).filter(Boolean);
    const subjectEnum = subjectNames.length ? { enum: subjectNames } : {};
    const typeEnum = typeNames.length ? { enum: typeNames } : {};

    return [
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
            description: '측정하지 못한 공부 세션을 기록한다 (예: "학원에서 수학 2시간 들었어"). 사용자가 기록을 요청했을 때만 호출. 과목은 반드시 사용자의 기존 과목 목록에서 고른다.',
            parameters: {
                type: 'object',
                properties: {
                    subject: { type: 'string', description: '과목명 (사용자의 기존 과목 목록에서만 선택)', ...subjectEnum },
                    sub_item: { type: 'string', description: '과목의 세부 항목(선택). 해당 과목의 하위 항목일 때만 반영된다.' },
                    type: { type: 'string', description: '세션 유형 (사용자의 기존 유형 목록에서만 선택)', ...typeEnum },
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
        {
            name: 'save_weekly_diary',
            description: '이번(또는 지정한) 주의 주간 회고 일기를 저장/수정한다. 한 주를 돌아보는 회고를 요청했을 때만 호출.',
            parameters: {
                type: 'object',
                properties: {
                    content: { type: 'string', description: '이번 주 회고/한마디 (자유 서술)' },
                    score: { type: 'number', description: '이번 주 점수 1-10 (선택)' },
                    week_start: { type: 'string', description: '그 주 월요일 YYYY-MM-DD. 생략 시 이번 주' },
                },
                required: ['content'],
            },
        },
        {
            name: 'add_todo',
            description: '체크리스트(할 일)에 항목을 추가한다 (예: "이번 주 할 일에 모의고사 오답 추가해줘").',
            parameters: {
                type: 'object',
                properties: {
                    scope: { type: 'string', description: '할 일 범위', enum: ['day', 'week', 'month'] },
                    text: { type: 'string', description: '할 일 내용' },
                },
                required: ['scope', 'text'],
            },
        },
        {
            name: 'list_todos',
            description: '체크리스트(할 일) 목록과 완료 상태를 조회한다. scope 생략 시 오늘·이번 주·이번 달 모두.',
            parameters: {
                type: 'object',
                properties: {
                    scope: { type: 'string', description: '할 일 범위(선택). 생략 시 전체', enum: ['day', 'week', 'month'] },
                },
            },
        },
        {
            name: 'complete_todo',
            description: '해당 범위에서 텍스트가 일치(또는 포함)하는 첫 미완료 할 일을 완료 처리한다 (예: "오늘 할 일 수학 다 했어").',
            parameters: {
                type: 'object',
                properties: {
                    scope: { type: 'string', description: '할 일 범위', enum: ['day', 'week', 'month'] },
                    text: { type: 'string', description: '완료할 할 일 텍스트(일치 또는 포함)' },
                },
                required: ['scope', 'text'],
            },
        },
        {
            name: 'save_learning_note',
            description: '세션에서 배운 개념/내용을 복기용 학습 노트로 저장한다. 사용자가 무엇을 배웠는지 공유하고 저장을 원할 때 호출. 과목은 사용자의 기존 과목 목록에서 고른다.',
            parameters: {
                type: 'object',
                properties: {
                    subject: { type: 'string', description: '과목명 (사용자의 기존 과목 목록에서만 선택)', ...subjectEnum },
                    sub_item: { type: 'string', description: '과목의 세부 항목(선택)' },
                    content: { type: 'string', description: '배운 내용 (자유 서술)' },
                    date: { type: 'string', description: 'YYYY-MM-DD. 생략 시 오늘' },
                },
                required: ['subject', 'content'],
            },
        },
        {
            name: 'search_learning_notes',
            description: '저장된 학습 노트를 의미 검색으로 찾아 복기한다. "복기", "예전에 공부한 ~ 개념 끌어와줘" 같은 회상 요청에 사용.',
            parameters: {
                type: 'object',
                properties: {
                    query: { type: 'string', description: '검색어/질문' },
                    subject: { type: 'string', description: '특정 과목으로 한정(선택)', ...subjectEnum },
                    top_k: { type: 'number', description: '가져올 최대 개수(선택, 기본 6)' },
                },
                required: ['query'],
            },
        },
    ];
}

/** 하위 호환용 기본 선언(enum 제약 없음). 실제 채팅은 buildChatFunctionDeclarations(settings) 를 사용한다. */
export const CHAT_FUNCTION_DECLARATIONS: GeminiFunctionDeclaration[] =
    buildChatFunctionDeclarations({ subjects: [], types: [] } as unknown as Settings);

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function normalizeDate(input: unknown, fallback: string): string {
    return typeof input === 'string' && DATE_RE.test(input) ? input : fallback;
}

/**
 * 모델이 준 과목명을 사용자의 기존 과목 목록으로 검증/정규화한다.
 * - 최상위 과목명과 일치 → 그대로 사용.
 * - 어떤 과목의 하위 항목(child)과 일치 → 부모 과목으로 재매핑하고 subItem 으로 기록.
 * - 둘 다 아니면 유효 과목 목록을 담은 에러를 돌려주어 모델이 다시 고르게 한다.
 */
function resolveSubject(
    settings: Settings,
    rawSubject: unknown,
): { subject: string; subItem?: string } | { error: string; valid_subjects: string[] } {
    const subject = String(rawSubject ?? '').trim();
    const names = settings.subjects.map((s) => s.name);
    if (subject && names.includes(subject)) return { subject };
    // 하위 항목(subItem) 매칭 → 부모 과목으로 재매핑
    for (const s of settings.subjects) {
        if (s.children?.some((c) => c === subject)) {
            return { subject: s.name, subItem: subject };
        }
    }
    return {
        error: `"${subject}" 은(는) 등록된 과목이 아닙니다. 아래 과목 중 가장 가까운 것으로 다시 선택하세요.`,
        valid_subjects: names,
    };
}

/** 선택한 과목의 하위 항목 목록 중 유효한 subItem 만 반환(아니면 undefined). */
function validSubItem(settings: Settings, subject: string, rawSubItem: unknown): string | undefined {
    const value = typeof rawSubItem === 'string' ? rawSubItem.trim() : '';
    if (!value) return undefined;
    const parent = settings.subjects.find((s) => s.name === subject);
    return parent?.children?.includes(value) ? value : undefined;
}

const TODO_SCOPES: TodoScope[] = ['day', 'week', 'month'];

function normalizeScope(input: unknown): TodoScope | null {
    return TODO_SCOPES.includes(input as TodoScope) ? (input as TodoScope) : null;
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
                const resolved = resolveSubject(settings, args.subject);
                if ('error' in resolved) return resolved;
                const subject = resolved.subject;
                // 유형 정규화: 등록된 유형이 아니면 '자습'으로 폴백
                const rawType = String(args.type ?? '').trim();
                const type = settings.types.includes(rawType) ? rawType : '자습';
                const subItem = resolved.subItem ?? validSubItem(settings, subject, args.sub_item);
                const minutes = Number(args.minutes);
                if (!Number.isFinite(minutes) || minutes <= 0 || minutes > 24 * 60) {
                    return { error: '올바른 분 단위 시간이 필요합니다.' };
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
                        error: `해당 시간대에 이미 기록이 있습니다 (${overlap.subject}, ${new Date(overlap.startTime).toTimeString().slice(0, 5)}~${new Date(overlap.endTime).toTimeString().slice(0, 5)}). 시작 시각을 알려주면 다시 기록할 수 있습니다.`,
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
                    ...(subItem ? { subItem } : {}),
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
                const id = await db.sessions.add(session);
                return { ok: true, session_id: id, date: session.date, saved: `${subItem ? `${subject}(${subItem})` : subject} ${type} ${minutes}분` };
            }
            case 'save_diary': {
                const date = normalizeDate(args.date, getTodayDate());
                const stats = await computeDiaryStats(date, settings.dailyGoalMs);
                const existing = await db.diaryEntries.get(date);
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
                await db.diaryEntries.put({
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
            case 'save_weekly_diary': {
                const content = typeof args.content === 'string' ? args.content.trim() : '';
                if (!content) return { error: '주간 회고 내용이 필요합니다.' };
                const weekStart = normalizeDate(args.week_start, getWeekKey());
                const scoreArg = Number(args.score);
                const existing = await getWeeklyDiary(weekStart);
                const score = Number.isFinite(scoreArg)
                    ? Math.max(1, Math.min(10, Math.round(scoreArg)))
                    : existing?.score;
                const now = Date.now();
                await saveWeeklyDiary({
                    weekStart,
                    content,
                    ...(score !== undefined ? { score } : {}),
                    aiReply: existing?.aiReply,
                    createdAt: existing?.createdAt ?? now,
                    updatedAt: now,
                });
                return { ok: true, week_start: weekStart, score: score ?? null };
            }
            case 'add_todo': {
                const scope = normalizeScope(args.scope);
                if (!scope) return { error: "scope 는 'day'|'week'|'month' 중 하나여야 합니다." };
                const text = typeof args.text === 'string' ? args.text.trim() : '';
                if (!text) return { error: '할 일 내용이 필요합니다.' };
                const id = await addTodo(scope, currentPeriodKey(scope), text);
                return { ok: true, todo_id: id, scope, saved: text };
            }
            case 'list_todos': {
                const scopeArg = normalizeScope(args.scope);
                const scopes = scopeArg ? [scopeArg] : TODO_SCOPES;
                const result: Record<string, Array<{ text: string; done: boolean }>> = {};
                for (const scope of scopes) {
                    const todos = await getTodos(scope, currentPeriodKey(scope));
                    result[scope] = todos.map((t) => ({ text: t.text, done: t.done }));
                }
                return { todos: result };
            }
            case 'complete_todo': {
                const scope = normalizeScope(args.scope);
                if (!scope) return { error: "scope 는 'day'|'week'|'month' 중 하나여야 합니다." };
                const text = typeof args.text === 'string' ? args.text.trim() : '';
                if (!text) return { error: '완료할 할 일 텍스트가 필요합니다.' };
                const todos = await getTodos(scope, currentPeriodKey(scope));
                const match = todos.find((t) => !t.done && (t.text === text || t.text.includes(text)));
                if (!match) return { error: `"${text}" 와(과) 일치하는 미완료 할 일을 찾지 못했습니다.` };
                await toggleTodo(match.id!);
                return { ok: true, scope, completed: match.text };
            }
            case 'save_learning_note': {
                const resolved = resolveSubject(settings, args.subject);
                if ('error' in resolved) return resolved;
                const subject = resolved.subject;
                const content = typeof args.content === 'string' ? args.content.trim() : '';
                if (!content) return { error: '배운 내용(content)이 필요합니다.' };
                const subItem = resolved.subItem ?? validSubItem(settings, subject, args.sub_item);
                const date = normalizeDate(args.date, getTodayDate());
                const now = Date.now();
                const id = await addLearningNote({
                    date,
                    subject,
                    ...(subItem ? { subItem } : {}),
                    content,
                    createdAt: now,
                    updatedAt: now,
                });
                // 임베딩 부착은 실패해도 노트는 유지되므로 기다리지 않는다(파이어앤포겟).
                void attachEmbedding(settings, id).catch(() => { /* ignore */ });
                return { ok: true, note_id: id, date, subject, saved: subItem ? `${subject}(${subItem})` : subject };
            }
            case 'search_learning_notes': {
                const query = typeof args.query === 'string' ? args.query.trim() : '';
                if (!query) return { error: '검색어(query)가 필요합니다.' };
                const topK = Number.isFinite(Number(args.top_k)) ? Math.max(1, Math.min(20, Math.round(Number(args.top_k)))) : 6;
                const subjectOpt = typeof args.subject === 'string' && settings.subjects.some((s) => s.name === args.subject)
                    ? args.subject
                    : undefined;
                const hits = await searchLearningNotes(settings, query, topK, { subject: subjectOpt });
                return {
                    count: hits.length,
                    hits: hits.map((h) => ({
                        date: h.note.date,
                        subject: h.note.subject,
                        sub_item: h.note.subItem ?? null,
                        content: h.note.content,
                        score: Math.round(h.score * 1000) / 1000,
                    })),
                };
            }
            default:
                return { error: `알 수 없는 함수: ${name}` };
        }
    } catch (e) {
        return { error: e instanceof Error ? e.message : '함수 실행 중 오류가 발생했습니다.' };
    }
}
