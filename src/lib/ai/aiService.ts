/**
 * aiService.ts — 앰비언트 AI 상위 서비스.
 *
 * 흐름: 기능 → 역할 선언 → 라우터가 모델 체인 구성 → 순차 시도(429 시 소진 마킹 후 다음 후보)
 *       → 캐시(kind+date) 저장. API 키 없음/예산 초과/전부 실패 시 null 또는 규칙 기반 폴백.
 *
 * 모든 생성물은 마크다운으로 취급하고 AiMarkdown 컴포넌트로 렌더링한다.
 */
import {
    formatDurationHourMinute,
    getAiArtifact,
    getTodayDate,
    putAiArtifact,
    type AiRole,
    type DiaryEntry,
    type DiaryStats,
    type Settings,
} from '../db';
import { generateContent, QuotaExceededError, type GenerateOptions, type GeminiReply } from '../gemini';
import { buildModelChain, markModelExhausted, supportsGrounding, ROLE_PROFILES } from './router';
import { canSpend, recordSpend } from './budget';
import { buildSystemInstruction } from './prompts';
import { buildDaySnapshot, buildRecentDaysSnapshot } from './snapshot';

/** 앰비언트 AI 사용 가능 여부 (키 등록 = 동의, 기본 켬). */
export function isAmbientAiEnabled(settings: Settings): boolean {
    return !!settings.geminiApiKey && settings.aiAmbientEnabled !== false;
}

/**
 * 역할 기반 생성. 체인의 각 모델을 순서대로 시도하고,
 * 429 는 소진으로 마킹 후 다음 후보로 넘어간다. 전부 실패하면 null.
 */
export async function generateForRole(
    settings: Settings,
    role: AiRole,
    kind: string,
    prompt: string,
    options: Omit<GenerateOptions, 'noFallback' | 'availableModels'> = {},
): Promise<GeminiReply | null> {
    if (!settings.geminiApiKey) return null;
    if (!canSpend(kind)) return null;

    const chain = await buildModelChain(role, settings);
    const profile = ROLE_PROFILES[role];
    // 설정의 역할별 thinking 오버라이드 우선, 없으면 프로파일 기본값
    const thinkingLevel = settings.aiThinkingLevels?.[role] ?? profile.thinkingLevel;

    for (const model of chain) {
        try {
            const reply = await generateContent(settings.geminiApiKey, model, prompt, {
                thinkingLevel,
                // 그라운딩은 지원 모델에서만 (options 로 켠 경우)
                ...options,
                useGrounding: options.useGrounding && supportsGrounding(model),
                noFallback: true,
            });
            recordSpend(kind, reply.usedModel);
            return reply;
        } catch (e) {
            if (e instanceof QuotaExceededError) {
                markModelExhausted(model);
                continue; // 체인 다음 후보로
            }
            // 쿼터 외 오류(네트워크·모델 미존재 등)도 다음 후보 시도
            continue;
        }
    }
    return null;
}

/** kind+date 캐시 우선 생성. 이미 있으면 즉시 반환. */
export async function getCachedOrGenerate(
    kind: string,
    date: string,
    generate: () => Promise<{ content: string; model: string } | null>,
): Promise<string | null> {
    const cached = await getAiArtifact(kind, date);
    if (cached) return cached.content;
    const result = await generate();
    if (!result) return null;
    await putAiArtifact({ kind, date, content: result.content, model: result.model, createdAt: Date.now() });
    return result.content;
}

// ── 일기: 한마디 초안 ───────────────────────────────────────────────────────

/** AI 없이 쓰는 규칙 기반 초안 (오프라인/키 없음/쿼터 소진 폴백). */
export function ruleBasedDiaryDraft(stats: DiaryStats): string {
    if (stats.totalMs === 0) return '오늘은 기록된 공부가 없다.';
    const top = stats.bySubject[0];
    const parts: string[] = [];
    parts.push(`${top ? top.subject + ' 중심으로 ' : ''}${formatDurationHourMinute(stats.totalMs)} 공부했다`);
    if (stats.goalPct !== null && stats.goalPct >= 100) parts.push('목표를 채웠다');
    else if (stats.drowsyCount > 0) parts.push(`졸음이 ${stats.drowsyCount}번 왔다`);
    return parts.join(', ') + '.';
}

export async function generateDiaryDraft(settings: Settings, date: string, stats: DiaryStats): Promise<string> {
    if (!isAmbientAiEnabled(settings)) return ruleBasedDiaryDraft(stats);
    const content = await getCachedOrGenerate('diary-draft', date, async () => {
        const snapshot = await buildDaySnapshot(date, settings.dailyGoalMs, true);
        const reply = await generateForRole(settings, 'ambient', 'diary-draft',
            `${snapshot}\n\n위 데이터로 오늘 일기의 "나의 한마디" 초안을 써주세요.`,
            { systemInstruction: buildSystemInstruction(settings, 'diaryDraft') });
        if (!reply?.text) return null;
        // 한 줄만, 따옴표 제거
        const line = reply.text.split('\n')[0].trim().replace(/^["'“”]|["'“”]$/g, '').slice(0, 100);
        return line ? { content: line, model: reply.usedModel } : null;
    });
    return content ?? ruleBasedDiaryDraft(stats);
}

// ── 일기: AI 답장 ───────────────────────────────────────────────────────────

export async function generateDiaryReply(settings: Settings, entry: DiaryEntry): Promise<string | null> {
    if (!isAmbientAiEnabled(settings)) return null;
    return getCachedOrGenerate('diary-reply', entry.date, async () => {
        const recent = await buildRecentDaysSnapshot(entry.date, 7, settings.dailyGoalMs);
        const prompt = [
            `[오늘 일기 (${entry.date})]`,
            `- 점수: ${entry.score}/10`,
            entry.dayTags.length ? `- 태그: ${entry.dayTags.join(', ')}` : '',
            entry.oneLiner ? `- 한마디: "${entry.oneLiner}"` : '',
            '',
            recent,
            '',
            '위 일기에 답장을 남겨주세요.',
        ].filter(l => l !== '').join('\n');
        const reply = await generateForRole(settings, 'ambient', 'diary-reply', prompt,
            { systemInstruction: buildSystemInstruction(settings, 'diaryReply') });
        if (!reply?.text) return null;
        return { content: reply.text.trim(), model: reply.usedModel };
    });
}

// ── 아침 리포트 ─────────────────────────────────────────────────────────────

/** 리포트 종류: 월요일엔 지난주 리뷰를 겸한다. */
export function morningReportKindFor(date: string): 'morning-report' | 'weekly-report' {
    return new Date(date + 'T12:00:00').getDay() === 1 ? 'weekly-report' : 'morning-report';
}

// 동시 호출(홈 카드 + 앱 레벨 팝업 등) 시 API 이중 호출을 막는 in-flight 공유 프라미스
let inflightMorningReport: { date: string; promise: Promise<string | null> } | null = null;

/**
 * 오늘의 아침 리포트를 캐시 우선으로 생성. (그날 첫 실행 시 호출)
 * 반환 null = 생성 불가(키 없음/쿼터/오프라인) → 카드 자체를 숨긴다.
 * 같은 날짜의 동시 호출은 하나의 생성 프라미스를 공유한다.
 */
export async function generateMorningReport(settings: Settings): Promise<string | null> {
    if (!isAmbientAiEnabled(settings)) return null;
    const today = getTodayDate();

    if (inflightMorningReport?.date === today) return inflightMorningReport.promise;
    const promise = generateMorningReportInner(settings, today).finally(() => {
        if (inflightMorningReport?.date === today) inflightMorningReport = null;
    });
    inflightMorningReport = { date: today, promise };
    return promise;
}

async function generateMorningReportInner(settings: Settings, today: string): Promise<string | null> {
    const kind = morningReportKindFor(today);

    return getCachedOrGenerate(kind, today, async () => {
        const yesterday = new Date(today + 'T12:00:00');
        yesterday.setDate(yesterday.getDate() - 1);
        const yStr = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, '0')}-${String(yesterday.getDate()).padStart(2, '0')}`;

        const yesterdaySnap = await buildDaySnapshot(yStr, settings.dailyGoalMs, true);
        const recentSnap = await buildRecentDaysSnapshot(yStr, kind === 'weekly-report' ? 14 : 7, settings.dailyGoalMs);
        const weeklyNote = kind === 'weekly-report'
            ? '\n오늘은 월요일입니다. 지난주 전체 리뷰(추세·요일 패턴)를 "어제 요약" 대신 첫 섹션으로 써주세요.'
            : '';
        const prompt = `${yesterdaySnap}\n\n${recentSnap}\n\n오늘 날짜: ${today}${weeklyNote}\n\n아침 브리핑을 작성해주세요.`;

        const reply = await generateForRole(settings, 'deep', kind, prompt, {
            systemInstruction: buildSystemInstruction(settings, 'morningReport'),
            useGrounding: settings.aiGroundingDefault !== false,
        });
        if (!reply?.text) return null;
        return { content: reply.text.trim(), model: reply.usedModel };
    });
}

// ── 세션 종료 코멘트 ────────────────────────────────────────────────────────

/**
 * 세션 종료 직후의 초단문 코멘트. 실패/예산 초과 시 null (조용히 생략).
 * 캐시하지 않는다 (세션마다 다름) — 대신 budget 의 하루 상한이 호출량을 제한.
 */
export async function generateSessionComment(
    settings: Settings,
    info: { subject: string; durationMs: number; score?: number; tags?: string[] },
): Promise<string | null> {
    if (!isAmbientAiEnabled(settings)) return null;
    if (!canSpend('session-comment')) return null;
    const today = getTodayDate();
    const recent = await buildRecentDaysSnapshot(today, 4, settings.dailyGoalMs);
    const prompt = [
        `[방금 끝난 세션]`,
        `- 과목: ${info.subject}, 길이: ${formatDurationHourMinute(info.durationMs)}`,
        info.score !== undefined ? `- 점수: ${info.score}/10` : '',
        info.tags?.length ? `- 태그: ${info.tags.join(', ')}` : '',
        '',
        recent,
        '',
        '이 세션에 한 줄 코멘트를 남겨주세요.',
    ].filter(l => l !== '').join('\n');
    const reply = await generateForRole(settings, 'ambient', 'session-comment', prompt, {
        systemInstruction: buildSystemInstruction(settings, 'sessionComment'),
    });
    return reply?.text?.trim() || null;
}
